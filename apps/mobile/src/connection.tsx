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
import * as ServiceDiscovery from "@inthepocket/react-native-service-discovery";
import type { Service } from "@inthepocket/react-native-service-discovery";

import type { DemoAgent, DemoAgentsResponse } from "./demo-contract";
import { devServerFallbackService, fetchDemoAgents, focusDemoAgent, serviceKey } from "./network";
import { useI18n } from "./i18n/I18nContext";
import {
  NetworkError,
  toErrorCode,
  toErrorStatus,
  type NetworkErrorCode,
} from "./i18n/errors";

const SERVICE_TYPE = "herdr-connect";
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
  | { phase: "connected"; service: Service; data: DemoAgentsResponse };

export type FocusPhase = "switching" | "switched" | "failed";

interface ConnectionValue {
  state: ConnectionState;
  focusResult?: { sourceID: string; phase: FocusPhase };
  refresh: () => Promise<void>;
  switchAgent: (service: Service, agent: DemoAgent) => Promise<void>;
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
  const servicesRef = useRef(new Map<string, Service>());
  const selectedKeyRef = useRef<string | undefined>(undefined);
  const requestRef = useRef<AbortController | undefined>(undefined);
  const discoveryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mountedRef = useRef(true);
  const pollingInflightRef = useRef(false);
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

  const switchAgent = useCallback(async (service: Service, agent: DemoAgent) => {
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
    async (service: Service) => {
      const key = serviceKey(service);
      selectedKeyRef.current = key;
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      clearDiscoveryTimer();

      try {
        const data = await fetchDemoAgents(service, controller.signal);
        if (mountedRef.current && selectedKeyRef.current === key && !controller.signal.aborted) {
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
      await ServiceDiscovery.stopSearch(SERVICE_TYPE);
      await ServiceDiscovery.startSearch(SERVICE_TYPE);
    } catch (error) {
      if (mountedRef.current) setState(failureFrom(error, "connect_failed"));
    }
  }, [beginNotFoundCountdown]);

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
    const foundListener = ServiceDiscovery.addEventListener("serviceFound", (service) => {
      const key = serviceKey(service);
      servicesRef.current.set(key, service);
      if (!selectedKeyRef.current) void connect(service);
    });
    const lostListener = ServiceDiscovery.addEventListener("serviceLost", (service) => {
      const key = serviceKey(service);
      servicesRef.current.delete(key);
      if (selectedKeyRef.current !== key) return;

      requestRef.current?.abort();
      selectedKeyRef.current = undefined;
      const nextService = servicesRef.current.values().next().value as Service | undefined;
      if (nextService) {
        void connect(nextService);
      } else {
        setState({ phase: "not_found" });
      }
    });

    beginNotFoundCountdown();
    void ensureAndroidLocalNetworkPermission(rationaleRef.current)
      .then(() => ServiceDiscovery.startSearch(SERVICE_TYPE))
      .catch((error: unknown) => {
        if (mountedRef.current) setState(failureFrom(error, "connect_failed"));
      });

    return () => {
      mountedRef.current = false;
      clearDiscoveryTimer();
      requestRef.current?.abort();
      foundListener.remove();
      lostListener.remove();
      void ServiceDiscovery.stopSearch(SERVICE_TYPE);
    };
  }, [beginNotFoundCountdown, clearDiscoveryTimer, connect]);

  const value = useMemo(
    () => ({ state, focusResult, refresh, switchAgent }),
    [state, focusResult, refresh, switchAgent],
  );

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}
