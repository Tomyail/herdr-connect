import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { AppState, NativeModules, PermissionsAndroid, Platform, type AppStateStatus } from "react-native";

import type { Agent, AgentsResponse } from "./agent-contract";
import {
  listenForDiscoveredServices,
  listenForDiscoveryFailure,
  startDiscoverySearch,
  stopDiscoverySearch,
  type DiscoveredService,
} from "./discovery";
import { discoveryRetryDelay, shouldRestartDiscovery } from "./discovery-lifecycle";
import { classifyProbeFailure, selectCandidates, serviceKey, type ServiceAssociations } from "./discovery-match";
import { devServerFallbackService, agentsEventsUrl, fetchAgents, focusAgent, preferredAddress } from "./network";
import { clearCredentials, loadCredentials, loadPairedInstances, selectActiveInstance } from "./credentials";
import {
  listInstances,
  resolveActiveInstance,
  type DeviceCredentials,
  type PairedInstancesModel,
} from "./paired-instances";
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
  | { phase: "daemon_outdated" }
  | { phase: "app_outdated" }
  | { phase: "failed"; code: NetworkErrorCode; status?: number }
  | { phase: "connected"; service: DiscoveredService; data: AgentsResponse };

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
  switchAgent: (service: DiscoveredService, agent: Agent) => Promise<void>;
  /** Unpair the ACTIVE installation locally (daemon-side revocation is
   *  separate). Other paired instances survive; if any remain, the connection
   *  falls back to the most recently paired one. */
  unpair: () => Promise<void>;
  /** All paired installations, most recently paired first (Settings list). */
  instances: DeviceCredentials[];
  /** Fingerprint of the active installation; `null` when nothing is paired. */
  activeFingerprint: string | null;
  /** Make another paired installation the active one. Single-active
   *  semantics: disconnect the old connection, then connect the new instance. */
  switchInstance: (fingerprint: string) => Promise<void>;
}

const ConnectionContext = createContext<ConnectionValue | undefined>(undefined);

export function useConnection(): ConnectionValue {
  const value = useContext(ConnectionContext);
  if (!value) throw new Error("useConnection must be used within a ConnectionProvider");
  return value;
}

interface ConnectedSnapshotOptions {
  mountedRef: RefObject<boolean>;
  pollingInflightRef: RefObject<boolean>;
  selectedKeyRef: RefObject<string | undefined>;
  /** Polling observed a terminal auth failure for the connected (active)
   *  instance; the provider removes that instance and updates the list. */
  onAuthInvalid: (kind: "unauthorized" | "revoked", key: string) => Promise<void>;
}

/**
 * Keeps a connected Agent snapshot fresh through polling plus an iOS SSE
 * signal. Keeping this lifecycle together makes its timer, stream, and
 * foreground cleanup ownership explicit without burying discovery setup.
 */
function useConnectedSnapshot({
  mountedRef,
  pollingInflightRef,
  selectedKeyRef,
  onAuthInvalid,
}: ConnectedSnapshotOptions) {
  const [state, setState] = useState<ConnectionState>({ phase: "discovering" });
  const [streamStatus, setStreamStatus] = useReducer(
    (_current: StreamStatus, next: StreamStatus) => next,
    "polling",
  );
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
        const data = await fetchAgents(service);
        if (mountedRef.current && selectedKeyRef.current === key) {
          setState({ phase: "connected", service, data });
        }
      } catch (error) {
        // 鉴权失败只针对当前活动实例（token 由 loadCredentials 按活动实例解析）。
        // key 守卫拦下过期 tick，避免切到新实例后误删新实例凭据。
        if (error instanceof NetworkError && (error.code === "unauthorized" || error.code === "revoked")) {
          if (selectedKeyRef.current === key) {
            await onAuthInvalid(error.code, key);
          }
        } else if (error instanceof NetworkError && error.code === "fingerprint_mismatch") {
          if (mountedRef.current && selectedKeyRef.current === key) {
            setState({ phase: "fingerprint_mismatch" });
          }
        } else if (error instanceof NetworkError && error.code === "daemon_outdated") {
          if (mountedRef.current && selectedKeyRef.current === key) {
            setState({ phase: "daemon_outdated" });
          }
        } else if (error instanceof NetworkError && error.code === "app_outdated") {
          if (mountedRef.current && selectedKeyRef.current === key) {
            setState({ phase: "app_outdated" });
          }
        }
        // Other errors: silent — keep the last snapshot on transient errors.
      } finally {
        pollingInflightRef.current = false;
      }
    };

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
      // Guard the async credential-read window so a background transition
      // cannot leave a newly opened stream without an owner to tear it down.
      const creds = await loadCredentials();
      if (!mountedRef.current || selectedKeyRef.current !== key || AppState.currentState !== "active") return;
      if (!creds) return;
      if (streamHandle) {
        try { streamHandle.stop(); } catch { /* ignore */ }
        streamHandle = undefined;
      }

      let handle: PinnedStreamHandle;
      try {
        const address = preferredAddress(service.addresses);
        if (!address) return;
        handle = startStream(
          agentsEventsUrl(address, service.port),
          creds.fingerprint,
          creds.token,
        );
      } catch (error) {
        const code = (error as PinnedStreamError | undefined)?.code;
        if (code === "unsupported_platform" || code === "invalid_url") return;
        scheduleReconnect();
        return;
      }
      streamHandle = handle;

      handle.onEvent(() => {
        if (!mountedRef.current || selectedKeyRef.current !== key) return;
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

    const handleStreamEnd = () => {
      streamHandle = undefined;
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
  }, [connectedService, mountedRef, onAuthInvalid, pollingInflightRef, selectedKeyRef]);

  return { state, setState, streamStatus };
}

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const servicesRef = useRef(new Map<string, DiscoveredService>());
  const selectedKeyRef = useRef<string | undefined>(undefined);
  /** 当前探测/连接中的候选服务键：防止发现重放打断有效探测（旧代码由
   *  selectedKey 提前占位承担同一职责，探测式匹配下命中前不能占位）。 */
  const connectInFlightRef = useRef<string | undefined>(undefined);
  /** 已验证的 serviceKey → fingerprint 关联（pinned TLS 握手成功时记录）。
   *  会话内缓存：切换实例后切回可免探测直连。 */
  const associationsRef = useRef<ServiceAssociations>({});
  /** 活动实例 fingerprint 的 ref 镜像：发现监听器不因切换而重挂载。 */
  const activeFingerprintRef = useRef<string | null>(null);
  const requestRef = useRef<AbortController | undefined>(undefined);
  const discoveryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mountedRef = useRef(true);
  const pollingInflightRef = useRef(false);
  const retryAttemptRef = useRef(0);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const [focusResult, setFocusResult] = useState<{ sourceID: string; phase: FocusPhase }>();
  const [instances, setInstances] = useState<DeviceCredentials[]>([]);
  const [activeFingerprint, setActiveFingerprint] = useState<string | null>(null);

  /** 把模型同步进 context 状态与 ref 镜像（活动实例经解析回退规则）。 */
  const applyModel = useCallback((model: PairedInstancesModel) => {
    const active = resolveActiveInstance(model);
    setInstances(listInstances(model));
    activeFingerprintRef.current = active?.fingerprint ?? null;
    setActiveFingerprint(active?.fingerprint ?? null);
  }, []);

  // 鉴权失效处理需要 setState（来自下方快照 hook），经 ref 转发打破定义环。
  const onAuthInvalidRef = useRef<ConnectedSnapshotOptions["onAuthInvalid"]>(async () => {});
  const callAuthInvalid = useCallback<ConnectedSnapshotOptions["onAuthInvalid"]>(
    (kind, key) => onAuthInvalidRef.current(kind, key),
    [],
  );

  const { state, setState, streamStatus } = useConnectedSnapshot({
    mountedRef,
    pollingInflightRef,
    selectedKeyRef,
    onAuthInvalid: callAuthInvalid,
  });

  /** 移除活动实例凭据并进入终态相位（401/revoked 路径）；其他实例保留。 */
  const removeActiveInstance = useCallback(
    async (phase: "not_paired" | "revoked") => {
      const model = await clearCredentials();
      if (!mountedRef.current) return;
      applyModel(model);
      setState({ phase });
    },
    [applyModel, setState],
  );

  /** Polling tick 观察到鉴权失效：先过 key 守卫再移除，防止过期 tick
   *  在切换实例后误删新活动实例的凭据。 */
  const handleTickAuthInvalid = useCallback(
    async (kind: "unauthorized" | "revoked", key: string) => {
      if (!mountedRef.current || selectedKeyRef.current !== key) return;
      await removeActiveInstance(kind === "revoked" ? "revoked" : "not_paired");
    },
    [removeActiveInstance],
  );
  onAuthInvalidRef.current = handleTickAuthInvalid;

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

  const switchAgent = useCallback(async (service: DiscoveredService, agent: Agent) => {
    setFocusResult({ sourceID: agent.source_id, phase: "switching" });
    try {
      await focusAgent(service, agent.source_id);
      setFocusResult({ sourceID: agent.source_id, phase: "switched" });
    } catch {
      setFocusResult({ sourceID: agent.source_id, phase: "failed" });
    }
  }, []);

  const clearDiscoveryTimer = useCallback(() => {
    if (discoveryTimerRef.current) clearTimeout(discoveryTimerRef.current);
    discoveryTimerRef.current = undefined;
  }, []);

  /**
   * 按候选顺序探测连接，直至 pinned TLS 握手命中活动实例的证书
   * fingerprint。mDNS 发现结果不含 TXT（fp=），服务与实例的对应关系只能由
   * pinned 握手验证：fingerprint_mismatch / 传输失败 → 换下一个候选；其余
   * 错误意味着 pin 已通过（目标实例的 daemon 返回的终态），按终态处理。
   * 全部候选未命中说明目标实例的 daemon 不在当前发现集中。
   */
  const connect = useCallback(
    async (candidates: readonly DiscoveredService[]) => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      clearDiscoveryTimer();

      let attemptCount = 0;
      let wrongDaemonCount = 0;
      let lastError: unknown;
      for (const service of candidates) {
        if (!mountedRef.current || controller.signal.aborted) {
          connectInFlightRef.current = undefined;
          return;
        }
        const key = serviceKey(service);
        connectInFlightRef.current = key;
        attemptCount += 1;
        try {
          const data = await fetchAgents(service, controller.signal);
          if (!mountedRef.current || controller.signal.aborted) {
            connectInFlightRef.current = undefined;
            return;
          }
          // pinned TLS 握手成功 = 证书 fingerprint 匹配活动实例，记录关联。
          const activeFp = activeFingerprintRef.current;
          if (activeFp) associationsRef.current[key] = activeFp;
          connectInFlightRef.current = undefined;
          selectedKeyRef.current = key;
          retryAttemptRef.current = 0;
          setState({ phase: "connected", service, data });
          return;
        } catch (error) {
          lastError = error;
          if (!mountedRef.current || controller.signal.aborted) {
            connectInFlightRef.current = undefined;
            return;
          }
          const failureKind = classifyProbeFailure(error);
          if (failureKind === "wrong_daemon") {
            wrongDaemonCount += 1;
            continue;
          }
          if (failureKind === "unreachable") continue;
          connectInFlightRef.current = undefined;
          // terminal：pin 已通过，错误属于目标实例。
          if (error instanceof NetworkError && (error.code === "unauthorized" || error.code === "revoked")) {
            await removeActiveInstance(error.code === "revoked" ? "revoked" : "not_paired");
            return;
          }
          if (error instanceof NetworkError && error.code === "daemon_outdated") {
            setState({ phase: "daemon_outdated" });
            return;
          }
          if (error instanceof NetworkError && error.code === "app_outdated") {
            setState({ phase: "app_outdated" });
            return;
          }
          setState(failureFrom(error, "connect_failed"));
          return;
        }
      }
      connectInFlightRef.current = undefined;
      if (wrongDaemonCount === attemptCount && attemptCount > 0) {
        // 每个候选都指纹不匹配：LAN 内的 daemon 都不是活动实例的。
        setState({ phase: "not_found" });
        return;
      }
      setState(failureFrom(lastError ?? new NetworkError("connect_failed"), "connect_failed"));
    },
    [clearDiscoveryTimer, removeActiveInstance, setState],
  );

  const beginNotFoundCountdown = useCallback(() => {
    clearDiscoveryTimer();
    discoveryTimerRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      const activeFingerprint = activeFingerprintRef.current;
      if (!activeFingerprint) return;
      // 探测仍在进行时不打断。
      if (connectInFlightRef.current) return;
      const services = [...servicesRef.current.values()];
      // “未找到”的判定对象是活动实例：LAN 内有其他实例的 daemon 不算找到。
      const hasCandidate =
        selectCandidates(services, activeFingerprint, associationsRef.current).length > 0;
      if (hasCandidate) return;
      const sourceCode = NativeModules.SourceCode as
        | { scriptURL?: string; getConstants?: () => { scriptURL?: string } }
        | undefined;
      const scriptURL = sourceCode?.getConstants?.().scriptURL ?? sourceCode?.scriptURL;
      const fallback = devServerFallbackService(scriptURL);
      if (fallback) {
        void connect([fallback]);
      } else {
        setState({ phase: "not_found" });
      }
    }, DISCOVERY_WAIT_MS);
  }, [clearDiscoveryTimer, connect, setState]);

  const refresh = useCallback(async () => {
    requestRef.current?.abort();
    selectedKeyRef.current = undefined;
    connectInFlightRef.current = undefined;
    servicesRef.current.clear();

    // Re-check credentials before restarting discovery — the user may have
    // paired, unpaired, or switched instances while the app was in another
    // screen. 加载本身携带旧键迁移。
    const model = await loadPairedInstances();
    if (!mountedRef.current) return;
    applyModel(model);
    if (!resolveActiveInstance(model)) {
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
  }, [applyModel, beginNotFoundCountdown, clearDiscoveryTimer, setState]);

  const unpair = useCallback(async () => {
    requestRef.current?.abort();
    selectedKeyRef.current = undefined;
    connectInFlightRef.current = undefined;
    servicesRef.current.clear();
    clearDiscoveryTimer();
    stopDiscoverySearch();
    // 只移除活动实例；其余实例保留，若有剩余则自动切到回退实例并重连。
    const model = await clearCredentials();
    if (!mountedRef.current) return;
    applyModel(model);
    if (resolveActiveInstance(model)) {
      setState({ phase: "discovering" });
      void refresh();
    } else {
      setState({ phase: "not_paired" });
    }
  }, [applyModel, clearDiscoveryTimer, refresh, setState]);

  /** 切换活动实例（单活语义）：持久化选择、断开旧连接、对新实例重新发现。
   *  并行保活属下一票（#54），本阶段允许重连成本。 */
  const switchInstance = useCallback(
    async (fingerprint: string) => {
      if (activeFingerprintRef.current === fingerprint) return;
      const model = await selectActiveInstance(fingerprint);
      if (!model || !mountedRef.current) return;
      applyModel(model);
      setState({ phase: "discovering" });
      void refresh();
    },
    [applyModel, refresh, setState],
  );

  // Retry: back off after non-terminal errors, but do NOT retry from
  // not_paired / revoked / fingerprint_mismatch / daemon_outdated /
  // app_outdated — those require user action (pair, accept the new daemon
  // identity, or upgrade one side).
  useEffect(() => {
    if (
      state.phase === "connected" ||
      state.phase === "discovering" ||
      state.phase === "not_paired" ||
      state.phase === "revoked" ||
      state.phase === "fingerprint_mismatch" ||
      state.phase === "daemon_outdated" ||
      state.phase === "app_outdated"
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
      // 探测进行中且目标候选仍在发现集中：不打断（防止发现重放触发探测风暴）。
      const inFlightKey = connectInFlightRef.current;
      if (inFlightKey && nextServices.has(inFlightKey)) return;

      const activeFingerprint = activeFingerprintRef.current;
      if (!activeFingerprint) return;

      if (selectedKey || inFlightKey) requestRef.current?.abort();
      selectedKeyRef.current = undefined;
      connectInFlightRef.current = undefined;

      // 按 fingerprint 匹配目标实例的候选（已验证关联优先、外来实例排除），
      // 取代旧的“取第一个发现结果”；探测循环在 connect 内完成身份验证。
      const candidates = selectCandidates(services, activeFingerprint, associationsRef.current);
      if (candidates.length === 0) {
        // 发现集里没有目标实例的服务（可能全是其他实例的 daemon 或为空）。
        if (selectedKey || inFlightKey) setState({ phase: "not_found" });
        return;
      }

      retryAttemptRef.current = 0;
      void connect(candidates);
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

    // Discovery itself is gated on having a paired instance — without one
    // we show not_paired and don't waste resources scanning.
    const setup = async () => {
      const model = await loadPairedInstances();
      if (!mountedRef.current) return;
      applyModel(model);
      if (!resolveActiveInstance(model)) {
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
  }, [applyModel, beginNotFoundCountdown, clearDiscoveryTimer, connect, setState]);

  const value = useMemo(
    () => ({
      state,
      focusResult,
      streamStatus,
      refresh,
      switchAgent,
      unpair,
      instances,
      activeFingerprint,
      switchInstance,
    }),
    [state, focusResult, streamStatus, refresh, switchAgent, unpair, instances, activeFingerprint, switchInstance],
  );

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}
