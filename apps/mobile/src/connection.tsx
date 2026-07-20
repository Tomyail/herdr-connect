import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, NativeModules, PermissionsAndroid, Platform, type AppStateStatus } from "react-native";

import type { DemoAgent, DemoAgentsResponse } from "./demo-contract";
import {
  listenForDiscoveredServices,
  listenForDiscoveryFailure,
  startDiscoverySearch,
  stopDiscoverySearch,
  type DiscoveredService,
} from "./discovery";
import { discoveryRetryDelay, shouldRestartDiscovery } from "./discovery-lifecycle";
import { devServerFallbackService, fetchDemoAgents, focusDemoAgent, serviceKey } from "./network";
import { useI18n } from "./i18n/I18nContext";
import {
  NetworkError,
  toErrorCode,
  toErrorStatus,
  type NetworkErrorCode,
} from "./i18n/errors";

const DISCOVERY_WAIT_MS = 6_000;
const AGENT_POLL_INTERVAL_MS = 3_000;

/** Rationale shown by Android on the second (already-denied) permission prompt. */
interface PermissionRationale {
  title: string;
  message: string;
  buttonPositive: string;
  buttonNegative: string;
}

async function ensureAndroidLocalNetworkPermission(rationale: PermissionRationale): Promise<void> {
  if (Platform.OS !== "android" || Number(Platform.Version) < 33) return;
  const permission = PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES;
  const result = await PermissionsAndroid.request(permission, rationale);
  if (result !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new NetworkError("nearby_permission_denied");
  }
}

function failureFrom(error: unknown, fallback: NetworkErrorCode) {
  return {
    phase: "failed" as const,
    code: toErrorCode(error, fallback),
    status: toErrorStatus(error),
  };
}

export type ConnectionState =
  | { phase: "discovering" }
  | { phase: "not_found" }
  | { phase: "failed"; code: NetworkErrorCode; status?: number }
  | { phase: "connected"; service: DiscoveredService; data: DemoAgentsResponse };

export type FocusPhase = "switching" | "switched" | "failed";

interface ConnectionValue {
  state: ConnectionState;
  focusResult?: { sourceID: string; phase: FocusPhase };
  refresh: () => Promise<void>;
  switchAgent: (service: DiscoveredService, agent: DemoAgent) => Promise<void>;
}

const ConnectionContext = createContext<ConnectionValue | undefined>(undefined);

export function useConnection(): ConnectionValue {
  const value = useContext(ConnectionContext);
  if (!value) throw new Error("useConnection must be used within a ConnectionProvider");
  return value;
}

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [state, setState] = useState<ConnectionState>({ phase: "discovering" });
  const servicesRef = useRef(new Map<string, DiscoveredService>());
  const selectedKeyRef = useRef<string | undefined>(undefined);
  const requestRef = useRef<AbortController | undefined>(undefined);
  const discoveryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mountedRef = useRef(true);
  const pollingInflightRef = useRef(false);
  const retryAttemptRef = useRef(0);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const [focusResult, setFocusResult] = useState<{ sourceID: string; phase: FocusPhase }>();

  // Keep the latest permission rationale without retriggering the discovery effect.
  const rationaleRef = useRef<PermissionRationale>({
    title: t("permission.android.title"),
    message: t("permission.android.message"),
    buttonPositive: t("permission.android.allow"),
    buttonNegative: t("permission.android.deny"),
  });
  rationaleRef.current = {
    title: t("permission.android.title"),
    message: t("permission.android.message"),
    buttonPositive: t("permission.android.allow"),
    buttonNegative: t("permission.android.deny"),
  };

  const switchAgent = useCallback(async (service: DiscoveredService, agent: DemoAgent) => {
    setFocusResult({ sourceID: agent.source_id, phase: "switching" });
    try {
      await focusDemoAgent(service, agent.source_id);
      setFocusResult({ sourceID: agent.source_id, phase: "switched" });
    } catch {
      setFocusResult({ sourceID: agent.source_id, phase: "failed" });
    }
  }, []);

  const clearDiscoveryTimer = useCallback(() => {
    if (discoveryTimerRef.current) clearTimeout(discoveryTimerRef.current);
    discoveryTimerRef.current = undefined;
  }, []);

  const connect = useCallback(
    async (service: DiscoveredService) => {
      const key = serviceKey(service);
      selectedKeyRef.current = key;
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      clearDiscoveryTimer();

      try {
        const data = await fetchDemoAgents(service, controller.signal);
        if (mountedRef.current && selectedKeyRef.current === key && !controller.signal.aborted) {
          retryAttemptRef.current = 0;
          setState({ phase: "connected", service, data });
        }
      } catch (error) {
        if (mountedRef.current && selectedKeyRef.current === key && !controller.signal.aborted) {
          setState(failureFrom(error, "connect_failed"));
        }
      }
    },
    [clearDiscoveryTimer],
  );

  const beginNotFoundCountdown = useCallback(() => {
    clearDiscoveryTimer();
    discoveryTimerRef.current = setTimeout(() => {
      if (mountedRef.current && servicesRef.current.size === 0) {
        const sourceCode = NativeModules.SourceCode as
          | { scriptURL?: string; getConstants?: () => { scriptURL?: string } }
          | undefined;
        const scriptURL = sourceCode?.getConstants?.().scriptURL ?? sourceCode?.scriptURL;
        const fallback = devServerFallbackService(scriptURL);
        if (fallback) {
          void connect(fallback);
        } else {
          setState({ phase: "not_found" });
        }
      }
    }, DISCOVERY_WAIT_MS);
  }, [clearDiscoveryTimer, connect]);

  const refresh = useCallback(async () => {
    requestRef.current?.abort();
    selectedKeyRef.current = undefined;
    servicesRef.current.clear();
    setState({ phase: "discovering" });
    beginNotFoundCountdown();

    try {
      stopDiscoverySearch();
      startDiscoverySearch();
    } catch (error) {
      if (mountedRef.current) setState(failureFrom(error, "connect_failed"));
    }
  }, [beginNotFoundCountdown]);

  useEffect(() => {
    if (state.phase === "connected" || state.phase === "discovering") return;

    const delay = discoveryRetryDelay(retryAttemptRef.current);
    retryAttemptRef.current += 1;
    const timer = setTimeout(() => {
      if (mountedRef.current && AppState.currentState === "active") void refresh();
    }, delay);
    return () => clearTimeout(timer);
  }, [refresh, state.phase]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next: AppStateStatus) => {
      const previous = appStateRef.current;
      appStateRef.current = next;
      if (shouldRestartDiscovery(previous, next)) void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  // Refresh the connected snapshot on a foreground-only interval so the UI stays
  // live and the done-chime can observe working -> done transitions. Polling is
  // paused off-foreground; transient fetch errors are silent to avoid disturbing
  // discovery (the last snapshot is kept).
  const connectedService = state.phase === "connected" ? state.service : undefined;
  useEffect(() => {
    if (!connectedService) return;
    const service = connectedService;
    const key = serviceKey(service);

    const tick = async () => {
      if (pollingInflightRef.current) return;
      pollingInflightRef.current = true;
      try {
        const data = await fetchDemoAgents(service);
        if (mountedRef.current && selectedKeyRef.current === key) {
          setState({ phase: "connected", service, data });
        }
      } catch {
        // Silent: keep the last snapshot on transient errors.
      } finally {
        pollingInflightRef.current = false;
      }
    };

    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        void tick();
      }, AGENT_POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    };

    const subscription = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") start();
      else stop();
    });
    if (AppState.currentState === "active") start();

    return () => {
      stop();
      subscription.remove();
    };
  }, [connectedService]);

  useEffect(() => {
    mountedRef.current = true;
    const resultsListener = listenForDiscoveredServices((services) => {
      const nextServices = new Map(
        services.map((service) => [serviceKey(service), service] as const),
      );
      servicesRef.current = nextServices;
      const selectedKey = selectedKeyRef.current;
      if (selectedKey && nextServices.has(selectedKey)) return;

      if (selectedKey) requestRef.current?.abort();
      selectedKeyRef.current = undefined;
      const nextService = nextServices.values().next().value;
      if (!nextService) {
        if (selectedKey) setState({ phase: "not_found" });
        return;
      }

      retryAttemptRef.current = 0;
      void connect(nextService);
    });
    const errorListener = listenForDiscoveryFailure(
      (error) => {
        requestRef.current?.abort();
        selectedKeyRef.current = undefined;
        servicesRef.current.clear();
        clearDiscoveryTimer();
        setState({
          phase: "failed",
          code: error.stage === "search"
            ? "discovery_search_failed"
            : "discovery_resolve_failed",
          status: error.code,
        });
      },
    );

    beginNotFoundCountdown();
    void ensureAndroidLocalNetworkPermission(rationaleRef.current)
      .then(() => startDiscoverySearch())
      .catch((error: unknown) => {
        if (mountedRef.current) setState(failureFrom(error, "connect_failed"));
      });

    return () => {
      mountedRef.current = false;
      clearDiscoveryTimer();
      requestRef.current?.abort();
      resultsListener.remove();
      errorListener.remove();
      stopDiscoverySearch();
    };
  }, [beginNotFoundCountdown, clearDiscoveryTimer, connect]);

  const value = useMemo(
    () => ({ state, focusResult, refresh, switchAgent }),
    [state, focusResult, refresh, switchAgent],
  );

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}
