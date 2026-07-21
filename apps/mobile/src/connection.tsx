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
import { devServerFallbackService, demoAgentsEventsUrl, fetchDemoAgents, focusDemoAgent, preferredAddress, serviceKey } from "./network";
import { loadCredentials, clearCredentials } from "./credentials";
import { startStream, type PinnedStreamHandle, type PinnedStreamError } from "pinned-stream";
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
  | { phase: "not_paired" }
  | { phase: "revoked" }
  | { phase: "fingerprint_mismatch" }
  | { phase: "failed"; code: NetworkErrorCode; status?: number }
  | { phase: "connected"; service: DiscoveredService; data: DemoAgentsResponse };

export type FocusPhase = "switching" | "switched" | "failed";

export type StreamStatus = "live" | "polling";

interface ConnectionValue {
  state: ConnectionState;
  focusResult?: { sourceID: string; phase: FocusPhase };
  /** Whether the agent list is being kept fresh by the live SSE stream ("live")
   *  or only by the 3s polling fallback ("polling"). Only meaningful when
   *  `state.phase === "connected"`; defaults to "polling" until the first
   *  SSE event arrives. */
  streamStatus: StreamStatus;
  refresh: () => Promise<void>;
  switchAgent: (service: DiscoveredService, agent: DemoAgent) => Promise<void>;
  /** Clear local pairing credentials and reset to "not_paired" state. */
  unpair: () => Promise<void>;
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
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("polling");

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
          if (error instanceof NetworkError && error.code === "unauthorized") {
            void clearCredentials().then(() => {
              if (mountedRef.current && selectedKeyRef.current === key) {
                setState({ phase: "not_paired" });
              }
            });
            return;
          }
          if (error instanceof NetworkError && error.code === "revoked") {
            void clearCredentials().then(() => {
              if (mountedRef.current && selectedKeyRef.current === key) {
                setState({ phase: "revoked" });
              }
            });
            return;
          }
          if (error instanceof NetworkError && error.code === "fingerprint_mismatch") {
            setState({ phase: "fingerprint_mismatch" });
            return;
          }
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

    // Re-check credentials before restarting discovery — the user may have
    // paired (or unpaired) while the app was in another screen.
    const creds = await loadCredentials();
    if (!mountedRef.current) return;
    if (!creds) {
      setState({ phase: "not_paired" });
      stopDiscoverySearch();
      clearDiscoveryTimer();
      return;
    }

    setState({ phase: "discovering" });
    beginNotFoundCountdown();

    try {
      stopDiscoverySearch();
      startDiscoverySearch();
    } catch (error) {
      if (mountedRef.current) setState(failureFrom(error, "connect_failed"));
    }
  }, [beginNotFoundCountdown, clearDiscoveryTimer]);

  const unpair = useCallback(async () => {
    requestRef.current?.abort();
    selectedKeyRef.current = undefined;
    servicesRef.current.clear();
    clearDiscoveryTimer();
    stopDiscoverySearch();
    await clearCredentials();
    if (mountedRef.current) {
      setState({ phase: "not_paired" });
    }
  }, [clearDiscoveryTimer]);

  // Retry: back off after non-terminal errors, but do NOT retry from
  // not_paired / revoked / fingerprint_mismatch — those require user action (pair, or
  // accept the new daemon identity).
  useEffect(() => {
    if (
      state.phase === "connected" ||
      state.phase === "discovering" ||
      state.phase === "not_paired" ||
      state.phase === "revoked" ||
      state.phase === "fingerprint_mismatch"
    ) return;

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

  // Refresh the connected snapshot via two coordinated channels:
  //   1. A 3s polling timer — always runs on foreground as a fallback so the
  //      UI stays fresh even when SSE is unavailable / broken.
  //   2. (iOS only) A pinned SSE stream that pushes a {cursor, online} signal
  //      whenever the daemon observes a real state change. On any event we
  //      stop the polling timer (save battery while live) and trigger the
  //      same `tick()` — the SSE channel is a THIN signal; it never carries
  //      the agent list, it just causes tick() to run sooner. The daemon
  //      guarantees it only emits on real changes, so every event → tick().
  // On stream error/close we flip to "polling", restart the polling timer so
  // there is no freshness gap, and schedule a reconnect using the same
  // exponential backoff curve as discovery (discoveryRetryDelay).
  const connectedService = state.phase === "connected" ? state.service : undefined;
  useEffect(() => {
    if (!connectedService) return;
    const service = connectedService;
    const key = serviceKey(service);
    // Reset to polling on (re)connect; the first SSE event will flip it to live.
    setStreamStatus("polling");

    const tick = async () => {
      if (pollingInflightRef.current) return;
      pollingInflightRef.current = true;
      try {
        const data = await fetchDemoAgents(service);
        if (mountedRef.current && selectedKeyRef.current === key) {
          setState({ phase: "connected", service, data });
        }
      } catch (error) {
        if (error instanceof NetworkError && error.code === "unauthorized") {
          await clearCredentials();
          if (mountedRef.current && selectedKeyRef.current === key) {
            setState({ phase: "not_paired" });
          }
        } else if (error instanceof NetworkError && error.code === "revoked") {
          await clearCredentials();
          if (mountedRef.current && selectedKeyRef.current === key) {
            setState({ phase: "revoked" });
          }
        } else if (error instanceof NetworkError && error.code === "fingerprint_mismatch") {
          if (mountedRef.current && selectedKeyRef.current === key) {
            setState({ phase: "fingerprint_mismatch" });
          }
        }
        // Other errors: silent — keep the last snapshot on transient errors.
      } finally {
        pollingInflightRef.current = false;
      }
    };

    // —— Polling timer management ——
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    const startPolling = () => {
      if (pollTimer) return;
      pollTimer = setInterval(() => {
        void tick();
      }, AGENT_POLL_INTERVAL_MS);
    };
    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
    };

    // —— SSE stream management ——
    // All stream-related mutable state is local to this effect so cleanup is
    // deterministic. A reconnect attempt counter backs off via discoveryRetryDelay.
    let streamHandle: PinnedStreamHandle | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let reconnectAttempt = 0;

    const clearReconnect = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
    };
    const stopStream = () => {
      clearReconnect();
      if (streamHandle) {
        // stop() suppresses the stream's own onClose/onError (quietClose in Swift),
        // so calling it here won't re-enter handleStreamEnd.
        try {
          streamHandle.stop();
        } catch {
          // stop() is best-effort; never let it throw the effect.
        }
        streamHandle = undefined;
      }
    };

    const openStream = async () => {
      // No credentials yet → stay on pure polling; the pairing effect will flip
      // state and re-run this effect when creds appear.
      // Also guard the await window: loadCredentials() is async (SecureStore read);
      // the app may have gone background while it was in flight. Re-checking
      // AppState.currentState here (in addition to mounted/key) closes the race
      // where startForeground→openStream started before a background transition
      // but resumed after stopForeground already ran with streamHandle still
      // undefined — without this check we'd open a background SSE connection that
      // nothing tears down. The same window exists for the scheduleReconnect
      // setTimeout path, which calls openStream after its own active check.
      const creds = await loadCredentials();
      if (!mountedRef.current || selectedKeyRef.current !== key || AppState.currentState !== "active") return;
      if (!creds) return;
      // If a previous attempt is still closing, make room.
      if (streamHandle) {
        try { streamHandle.stop(); } catch { /* ignore */ }
        streamHandle = undefined;
      }

      let handle: PinnedStreamHandle;
      try {
        const address = preferredAddress(service.addresses);
        if (!address) return; // nothing to dial
        handle = startStream(
          demoAgentsEventsUrl(address, service.port),
          creds.fingerprint,
          creds.token,
        );
      } catch (error) {
        // Non-iOS or module-not-linked throws synchronously (unsupported_platform).
        // Treat exactly like a stream error: poll, back off, retry — but there is
        // no point retrying an unsupported platform forever; a short fixed delay
        // keeps the behavior uniform without spamming retries.
        const code = (error as PinnedStreamError | undefined)?.code;
        if (code === "unsupported_platform" || code === "invalid_url") {
          // Permanent for this device: don't retry, polling covers freshness.
          return;
        }
        scheduleReconnect();
        return;
      }
      streamHandle = handle;

      handle.onEvent(() => {
        if (!mountedRef.current || selectedKeyRef.current !== key) return;
        // Stream is healthy: stop redundant polling, mark live, reset backoff,
        // and run tick() immediately to pull the new state. The daemon only
        // emits on real changes, so we don't dedup on cursor here.
        clearReconnect();
        reconnectAttempt = 0;
        stopPolling();
        setStreamStatus("live");
        void tick();
      });

      handle.onError(() => {
        if (!mountedRef.current || selectedKeyRef.current !== key) return;
        handleStreamEnd();
      });
      handle.onClose(() => {
        if (!mountedRef.current || selectedKeyRef.current !== key) return;
        handleStreamEnd();
      });
    };

    // Stream broke (onError/onClose) OR an unsupported_platform-style throw was
    // caught and we want to retry: ensure polling is running so freshness never
    // gaps, flip UI to "polling", and schedule the next openStream attempt.
    const handleStreamEnd = () => {
      streamHandle = undefined; // the native side already tore it down
      clearReconnect();
      setStreamStatus("polling");
      if (AppState.currentState === "active") startPolling();
      scheduleReconnect();
    };

    const scheduleReconnect = () => {
      clearReconnect();
      const delay = discoveryRetryDelay(reconnectAttempt);
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        if (mountedRef.current && AppState.currentState === "active" && selectedKeyRef.current === key) {
          void openStream();
        }
      }, delay);
    };

    // —— Foreground/background gating ——
    const startForeground = () => {
      startPolling();
      if (Platform.OS === "ios") void openStream();
    };
    const stopForeground = () => {
      stopPolling();
      stopStream();
      setStreamStatus("polling");
    };

    const subscription = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") startForeground();
      else stopForeground();
    });
    if (AppState.currentState === "active") startForeground();

    return () => {
      stopPolling();
      stopStream();
      subscription.remove();
    };
  }, [connectedService]);

  useEffect(() => {
    mountedRef.current = true;

    // Bonjour listeners are registered unconditionally — they survive the
    // whole component lifetime. If they were gated on "has credentials",
    // refresh() after a first-time pairing would have no listeners to consume
    // discovery results and the app would be stuck in "discovering" forever.
    const resultsListener = listenForDiscoveredServices((services) => {
      const nextServices = new Map(
        services.map((s) => [serviceKey(s), s] as const),
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

    // Discovery itself is gated on credential presence — without credentials
    // we show not_paired and don't waste resources scanning.
    const setup = async () => {
      const creds = await loadCredentials();
      if (!mountedRef.current) return;
      if (!creds) {
        setState({ phase: "not_paired" });
        return;
      }

      beginNotFoundCountdown();
      void ensureAndroidLocalNetworkPermission(rationaleRef.current)
        .then(() => startDiscoverySearch())
        .catch((error: unknown) => {
          if (mountedRef.current) setState(failureFrom(error, "connect_failed"));
        });
    };

    setup();

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
    () => ({ state, focusResult, streamStatus, refresh, switchAgent, unpair }),
    [state, focusResult, streamStatus, refresh, switchAgent, unpair],
  );

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}
