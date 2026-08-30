/**
 * ConnectionProvider:并行连接编排(issue #54)。
 *
 * 单实例连接会话(发现匹配 → pinned SSE 流 → 轮询降级 → 指数退避重连 →
 * AppState 前后台启停)已提取为 connection-session.ts(prefactor);本
 * provider 按 session-registry.ts 的纯决策为**每个**已配对安装实例维护一份
 * 会话,App 前台期间全部并行长连,无焦点/非焦点降级档位。
 *
 * 职责划分:
 *
 * - provider:mDNS 发现的启停与事件分发(全服共享一份监听)、会话集合
 *   reconcile(实例增删/重新配对/鉴权失效)、退避重试节流(多会话共享
 *   一个重试定时器 + mDNS kick)、活动实例指针(UI 渲染焦点)。
 * - 会话:各自的探测/轮询/SSE/重连(见 connection-session.ts)。
 * - 纯决策:session-registry.ts(Seam B 测试)。
 *
 * 切换活动实例只改指针,不断开任何会话——新焦点的会话与数据早已就绪,
 * 切换瞬间完成。UI 的 `state` 始终是活动实例会话的状态,既有消费方语义
 * 不变;`instanceStates` 暴露每实例连接状态供后续 UI(徽标属 #55)查询。
 */

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
import { AppState, PermissionsAndroid, Platform, type AppStateStatus } from "react-native";

import type { Agent } from "./agent-contract";
import {
  listenForDiscoveredServices,
  listenForDiscoveryFailure,
  startDiscoverySearch,
  stopDiscoverySearch,
  type DiscoveredService,
} from "./discovery";
import { discoveryRetryDelay } from "./discovery-lifecycle";
import { serviceKey, type ServiceAssociations } from "./discovery-match";
import { toErrorCode } from "./i18n/errors";
import { focusAgent, revokeDevice } from "./network";
import { loadPairedInstances, removeInstanceCredentials, selectActiveInstance } from "./credentials";
import {
  listInstances,
  resolveActiveInstance,
  type DeviceCredentials,
  type PairedInstancesModel,
} from "./paired-instances";
import { deleteInstanceAlias } from "./instance-alias-storage";
import {
  classifyRevocationFailure,
  planForgetInstance,
} from "./instance-revocation";
import {
  planForegroundTransition,
  planSessionRetry,
  planSessionSet,
} from "./session-registry";
import {
  ConnectionSession,
  type ConnectionState,
  type StreamStatus,
} from "./connection-session";
import { useI18n } from "./i18n/I18nContext";
import { NetworkError, type NetworkErrorCode } from "./i18n/errors";

export type { ConnectionState, StreamStatus, AuthInvalidKind } from "./connection-session";

export type FocusPhase = "switching" | "switched" | "failed";

/** 每实例连接状态摘要(供 UI 查询;徽标呈现属 #55)。 */
export interface InstanceSessionStatus {
  /** 该实例会话的连接相位(connected 即可达)。 */
  readonly phase: ConnectionState["phase"];
  /** "live" = SSE 流驱动;"polling" = 仅轮询降级。 */
  readonly streamStatus: StreamStatus;
}

interface ConnectionValue {
  /** 活动实例会话的连接状态(无实例时为 not_paired 或鉴权终态)。UI 主消费面。 */
  state: ConnectionState;
  focusResult?: { sourceID: string; phase: FocusPhase };
  /** 活动实例的刷新通道("live" = SSE 流,"polling" = 轮询降级;
   *  仅 connected 时有意义)。 */
  streamStatus: StreamStatus;
  refresh: () => Promise<void>;
  switchAgent: (service: DiscoveredService, agent: Agent) => Promise<void>;
  /** Unpair the ACTIVE installation locally (daemon-side revocation is
   *  separate). Other paired instances survive; if any remain, the active
   *  pointer falls back and their already-running sessions take over. */
  unpair: () => Promise<void>;
  /** All paired installations, most recently paired first (Settings list). */
  instances: DeviceCredentials[];
  /** Fingerprint of the active installation; `null` when nothing is paired. */
  activeFingerprint: string | null;
  /** Make another paired installation the active one. 并行模型:只改活动
   *  指针(持久化 + UI 焦点),会话全部保持,切换瞬间完成。 */
  switchInstance: (fingerprint: string) => Promise<void>;
  /** 每实例连接状态(fingerprint → 摘要),并行会话的可达性查询面。 */
  instanceStates: Readonly<Record<string, InstanceSessionStatus>>;
  /** 忘记实例(本地凭据 + 本机别名删除,远端 token 同步吊销)。 */
  forgetInstance: (
    fingerprint: string,
    options?: { readonly localOnly?: boolean },
  ) => Promise<ForgetResult>;
}

/** 忘记实例的编排结果,决策规则见 instance-revocation.ts;UI 映射提示。 */
export type ForgetResult =
  /** 完成:本地凭据与别名已删(远端已吊销或本就无效,或用户选了仅本地删除)。 */
  | { readonly outcome: "forgotten" }
  /** daemon 未连接(无已验证地址可发吊销):未动任何本地状态,交用户裁决。 */
  | { readonly outcome: "revocation_unavailable" }
  /** 吊销请求失败(daemon 拒绝/不可达):未动任何本地状态,交用户裁决。 */
  | { readonly outcome: "revocation_failed"; readonly code: NetworkErrorCode }
  /** fingerprint 不在已配对集合中(幂等重入/已被鉴权终态移除)。 */
  | { readonly outcome: "not_found" };

const ConnectionContext = createContext<ConnectionValue | undefined>(undefined);

export function useConnection(): ConnectionValue {
  const value = useContext(ConnectionContext);
  if (!value) throw new Error("useConnection must be used within a ConnectionProvider");
  return value;
}

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

interface SessionSnapshotEntry {
  readonly state: ConnectionState;
  readonly streamStatus: StreamStatus;
}

const NOT_PAIRED_STATE: ConnectionState = { phase: "not_paired" };
const DISCOVERING_STATE: ConnectionState = { phase: "discovering" };

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();

  /** fingerprint → 并行会话(每已配对实例一份)。 */
  const sessionsRef = useRef(new Map<string, ConnectionSession>());
  /** 共享的 mDNS 发现集(全量快照,分发给每个会话)。 */
  const servicesRef = useRef(new Map<string, DiscoveredService>());
  /** 跨会话共享的已验证 serviceKey → fingerprint 关联(会话内缓存,
   *  防并行探测风暴,见 connection-session.ts)。 */
  const associationsRef = useRef<ServiceAssociations>({});
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const activeFingerprintRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const retryAttemptRef = useRef(0);

  const [instances, setInstances] = useState<DeviceCredentials[]>([]);
  const [activeFingerprint, setActiveFingerprint] = useState<string | null>(null);
  const [sessionSnapshots, setSessionSnapshots] = useState<Readonly<Record<string, SessionSnapshotEntry>>>({});
  /** 模型首载完成前维持 discovering(冷启动不闪 not_paired)。 */
  const [modelLoaded, setModelLoaded] = useState(false);
  const [focusResult, setFocusResult] = useState<{ sourceID: string; phase: FocusPhase }>();

  // 会话回调需要 syncModel,经 ref 转发打破定义环(syncModel 建会话 → 会话
  // 回调 onAuthInvalid → syncModel)。
  const syncModelRef = useRef<(model: PairedInstancesModel) => void>(() => {});
  const restartDiscoveryRef = useRef<() => void>(() => {});

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = undefined;
    }
  }, []);

  /**
   * 统一退避重试:任一会话处于可重试相位(not_found/failed)时按
   * discoveryRetryDelay 退避,到点重启对应会话的探测并 kick 一次 mDNS
   * 发现(既有"failed/not_found → refresh"的并行化,节流为单定时器;
   * 已连接会话被防抖守卫保护,不受发现重放影响)。
   */
  const scheduleRetry = useCallback((phases: ReadonlyMap<string, string>) => {
    const plan = planSessionRetry(phases);
    if (plan.restartProbes.length === 0) {
      clearRetryTimer();
      // 有会话仍在 discovering(宽限倒计时推进中):只挂起重试,保留退避
      // 计数;全部落定才归零,避免 not_found 循环把退避钉死在首档。
      if (!plan.probing) retryAttemptRef.current = 0;
      return;
    }
    if (retryTimerRef.current) return;
    const delay = discoveryRetryDelay(retryAttemptRef.current);
    retryAttemptRef.current += 1;
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = undefined;
      if (!mountedRef.current || appStateRef.current !== "active") return; // 回前台由 begin 路径重新触发
      const currentPhases = new Map<string, string>();
      for (const [fingerprint, session] of sessionsRef.current) {
        currentPhases.set(fingerprint, session.getState().phase);
      }
      const currentPlan = planSessionRetry(currentPhases);
      if (currentPlan.restartDiscovery) restartDiscoveryRef.current();
      for (const fingerprint of currentPlan.restartProbes) {
        sessionsRef.current.get(fingerprint)?.begin();
      }
    }, delay);
  }, [clearRetryTimer]);

  /** 汇总全部会话状态 + 编排统一退避重试(节流共享一个定时器)。 */
  const publish = useCallback(() => {
    if (!mountedRef.current) return;
    const snapshots: Record<string, SessionSnapshotEntry> = {};
    const phases = new Map<string, string>();
    for (const [fingerprint, session] of sessionsRef.current) {
      snapshots[fingerprint] = { state: session.getState(), streamStatus: session.getStreamStatus() };
      phases.set(fingerprint, session.getState().phase);
    }
    setSessionSnapshots(snapshots);
    scheduleRetry(phases);
  }, [scheduleRetry]);

  /** mDNS 发现重启(有会话在跑才扫描)。 */
  const restartDiscovery = useCallback(() => {
    if (sessionsRef.current.size === 0) return;
    stopDiscoverySearch();
    startDiscoverySearch();
  }, []);
  restartDiscoveryRef.current = restartDiscovery;

  /** 鉴权终态覆盖:被移除的实例是最后一个且曾为活动实例时,UI 落在
   *  revoked/not_paired 终态(而不是中性的 not_paired),与既有单实例
   *  语义一致;有剩余实例时指针回退,不需要覆盖。 */
  const [authTerminalState, setAuthTerminalState] = useState<ConnectionState | null>(null);

  /** 鉴权失效:只解绑对应实例,其余会话不受影响;若移除的是活动实例,
   *  活动指针按 paired-instances 规则回退,焦点自动切到回退会话。多个
   *  会话并发观察到各自实例的 401/revoked 时,由 credentials.ts 的模型
   *  变更串行队列逐个完整执行,不会交错覆盖。 */
  const handleAuthInvalid = useCallback((kind: "unauthorized" | "revoked", fingerprint: string) => {
    const run = async () => {
      const wasActive = activeFingerprintRef.current === fingerprint;
      try {
        const model = await removeInstanceCredentials(fingerprint);
        if (!mountedRef.current) return;
        syncModelRef.current(model);
        if (wasActive && Object.keys(model.instances).length === 0) {
          setAuthTerminalState(kind === "revoked" ? { phase: "revoked" } : { phase: "not_paired" });
        }
      } catch (error) {
        // Keychain 故障:凭据未能解绑。会话落到明确终态(failed),绝不让
        // rejection 漏出——调用链是 void connect()/void tick(),无人接。
        sessionsRef.current.get(fingerprint)?.failWith(toErrorCode(error, "connect_failed"));
      }
    };
    return run();
  }, []);

  /**
   * 模型 → context 状态 + 会话集合 reconcile:按 planSessionSet 增删/替换
   * 会话(新会话立即 begin,并行接入),活动实例指针同步给 UI。有实例
   * 存活时清掉鉴权终态覆盖(指针回退后会话状态接管)。
   */
  const syncModel = useCallback((model: PairedInstancesModel) => {
    if (!mountedRef.current) return;
    const active = resolveActiveInstance(model);
    const desired = listInstances(model);
    setInstances(desired);
    activeFingerprintRef.current = active?.fingerprint ?? null;
    setActiveFingerprint(active?.fingerprint ?? null);
    if (active) setAuthTerminalState(null);

    const existing = new Map<string, DeviceCredentials>();
    for (const [fingerprint, session] of sessionsRef.current) {
      existing.set(fingerprint, session.sessionCredentials);
    }
    const planSet = planSessionSet(desired, existing);
    for (const fingerprint of planSet.stop) {
      sessionsRef.current.get(fingerprint)?.stop();
      sessionsRef.current.delete(fingerprint);
    }
    // 无任何会话存活(全部解绑/被拒):停掉 mDNS 扫描,发现事件不再到达。
    if (sessionsRef.current.size === 0) stopDiscoverySearch();
    for (const credentials of planSet.start) {
      const session = new ConnectionSession({
        credentials,
        associations: associationsRef.current,
        foreground: appStateRef.current === "active",
        streamSupported: Platform.OS === "ios",
        onAuthInvalid: (kind) => handleAuthInvalid(kind, credentials.fingerprint),
        onChanged: publish,
      });
      sessionsRef.current.set(credentials.fingerprint, session);
      session.begin(
        [...servicesRef.current.values()],
        { foreground: appStateRef.current === "active" },
      );
    }
    publish();
  }, [handleAuthInvalid, publish]);
  syncModelRef.current = syncModel;

  // Keep the latest permission rationale without retriggering the setup effect.
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

  /** 重载模型 + reconcile 会话 + 重启发现(配对完成、手动刷新)。
   *  已连接的活动实例强制重拉一次快照(main 版既有语义);mDNS 重启对
   *  已连接会话无打扰(发现重放被防抖守卫拦截)。 */
  const refresh = useCallback(async () => {
    const model = await loadPairedInstances();
    if (!mountedRef.current) return;
    syncModel(model);
    setModelLoaded(true);
    sessionsRef.current.get(activeFingerprintRef.current ?? "")?.refreshSnapshot();
    restartDiscovery();
  }, [restartDiscovery, syncModel]);

  /** 解绑活动实例:其余实例会话照常运行,活动指针自动回退(零等待)。 */
  const unpair = useCallback(async () => {
    const active = activeFingerprintRef.current;
    if (!active) return;
    const model = await removeInstanceCredentials(active);
    if (!mountedRef.current) return;
    syncModel(model);
  }, [syncModel]);

  /** 切换活动实例:只持久化指针并同步 UI 焦点。会话集合不变、零断开。 */
  const switchInstance = useCallback(async (fingerprint: string) => {
    if (activeFingerprintRef.current === fingerprint) return;
    const model = await selectActiveInstance(fingerprint);
    if (!model || !mountedRef.current) return;
    syncModel(model);
  }, [syncModel]);

  /**
   * 忘记实例(issue #55):本地凭据 + 本机别名删除,远端 token 同步吊销。
   *
   * 编排决策在 instance-revocation.ts(纯):吊销成功或服务端本就无效
   * (401)→ 继续本地删除;不可达/失败 → 不动本地状态,把决策交回用户
   * (仅本地删除/重试/取消,不静默)。吊销地址只取该实例会话已验证的
   * connected 服务——未连接时无可靠地址可发,按 revocation_unavailable
   * 交用户裁决。忘记活动实例后活动指针回退沿用 #53 的既有规则。
   */
  const forgetInstance = useCallback(
    async (
      fingerprint: string,
      options?: { readonly localOnly?: boolean },
    ): Promise<ForgetResult> => {
      const model = await loadPairedInstances();
      const credentials = model.instances[fingerprint];
      if (!credentials) return { outcome: "not_found" };
      if (!options?.localOnly) {
        const sessionState = sessionsRef.current.get(fingerprint)?.getState();
        const service =
          sessionState?.phase === "connected" ? sessionState.service : undefined;
        if (!service) return { outcome: "revocation_unavailable" };
        try {
          await revokeDevice(service, {
            fingerprint: credentials.fingerprint,
            token: credentials.token,
          });
        } catch (error) {
          const code = toErrorCode(error, "revoke_http");
          const plan = planForgetInstance(classifyRevocationFailure(code));
          if (!plan.removeLocal) return { outcome: "revocation_failed", code };
        }
      }
      const next = await removeInstanceCredentials(fingerprint);
      deleteInstanceAlias(fingerprint);
      if (mountedRef.current) syncModel(next);
      return { outcome: "forgotten" };
    },
    [syncModel],
  );

  useEffect(() => {
    mountedRef.current = true;

    // Bonjour listeners are registered unconditionally — they survive the whole
    // provider lifetime and results are fanned out to every parallel session.
    const resultsListener = listenForDiscoveredServices((services) => {
      servicesRef.current = new Map(services.map((service) => [serviceKey(service), service] as const));
      for (const session of sessionsRef.current.values()) {
        session.handleServices(services);
      }
    });
    const errorListener = listenForDiscoveryFailure((failure) => {
      for (const session of sessionsRef.current.values()) {
        session.handleDiscoveryFailure(failure);
      }
    });

    // 前后台:退到 background 才全停(spec 决策:停轮询/SSE/重连,状态
    // 保留);短暂 inactive(iOS 下拉通知中心/系统弹窗)维持现状不断流;
    // 回前台恢复全部会话并重启发现。
    const appStateSubscription = AppState.addEventListener("change", (next: AppStateStatus) => {
      const previous = appStateRef.current;
      appStateRef.current = next;
      const plan = planForegroundTransition(previous, next);
      if (plan.sessionAction === "pause") {
        for (const session of sessionsRef.current.values()) session.pause();
        return;
      }
      if (plan.sessionAction !== "begin" || !plan.restartDiscovery) return;
      const resume = async () => {
        const model = await loadPairedInstances();
        if (!mountedRef.current) return;
        syncModelRef.current(model);
        // load 期间又退后台:不重启(下一次回前台会重放)。
        if (appStateRef.current !== "active") return;
        for (const session of sessionsRef.current.values()) session.begin();
        restartDiscoveryRef.current();
      };
      void resume();
    });

    // Cold start: load the model, spawn a session per paired instance, then
    // start discovery. Discovery is gated on having at least one session —
    // without one we show not_paired and don't waste resources scanning.
    const setup = async () => {
      const model = await loadPairedInstances();
      if (!mountedRef.current) return;
      syncModel(model);
      setModelLoaded(true);
      if (sessionsRef.current.size === 0) return;
      try {
        await ensureAndroidLocalNetworkPermission(rationaleRef.current);
        startDiscoverySearch();
      } catch (error: unknown) {
        if (!mountedRef.current) return;
        const code = toErrorCode(error, "connect_failed");
        for (const session of sessionsRef.current.values()) {
          session.failWith(code);
        }
      }
    };

    void setup();

    return () => {
      mountedRef.current = false;
      clearRetryTimer();
      for (const session of sessionsRef.current.values()) session.stop();
      sessionsRef.current.clear();
      resultsListener.remove();
      errorListener.remove();
      appStateSubscription.remove();
      stopDiscoverySearch();
    };
  }, [clearRetryTimer, publish, syncModel]);

  /** UI 主消费面:活动实例会话的状态(未加载 → discovering;无实例 →
   *  鉴权终态覆盖或 not_paired)。 */
  const activeSnapshot = activeFingerprint ? sessionSnapshots[activeFingerprint] : undefined;
  const state: ConnectionState = !modelLoaded
    ? DISCOVERING_STATE
    : (activeSnapshot?.state ?? authTerminalState ?? NOT_PAIRED_STATE);
  const streamStatus: StreamStatus = activeSnapshot?.streamStatus ?? "polling";

  /** 每实例状态摘要(投影出轻量形状供 UI 徽标等消费)。 */
  const instanceStates = useMemo<Readonly<Record<string, InstanceSessionStatus>>>(() => {
    const projected: Record<string, InstanceSessionStatus> = {};
    for (const [fingerprint, entry] of Object.entries(sessionSnapshots)) {
      projected[fingerprint] = { phase: entry.state.phase, streamStatus: entry.streamStatus };
    }
    return projected;
  }, [sessionSnapshots]);

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
      instanceStates,
      forgetInstance,
    }),
    [state, focusResult, streamStatus, refresh, switchAgent, unpair, instances, activeFingerprint, switchInstance, instanceStates, forgetInstance],
  );

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}
