/**
 * 单实例连接会话(issue #54 prefactor:从 ConnectionProvider 提取)。
 *
 * 一个 ConnectionSession 负责**一个**已配对安装实例的完整连接生命周期:
 *
 *   发现匹配(pinned TLS 探测候选)→ 连接 → SSE 事件流(优先)→ 轮询
 *   降级 → 指数退避重连 → AppState 前后台启停。
 *
 * 会话是无 React 依赖的编排对象:ConnectionProvider 按 session-registry.ts
 * 的纯决策为每个已配对实例实例化一份并行运行,发现结果、发现失败与前后台
 * 事件由 provider 分发到各会话。会话之间不区分焦点——所有会话平等长连,
 * 切换活动实例零成本(会话与数据早已就绪)。
 *
 * 身份验证的探测关联缓存(ServiceAssociations)由 provider 持有、跨会话
 * 共享:一个会话通过 pinned TLS 验证 serviceKey→fingerprint 后,其他会话
 * 直接复用(命中)或排除(外来实例),防止并行化后的探测风暴。缓存语义
 * 沿用 #53:App 会话内存活、不落盘。
 *
 * 决策类逻辑(会话集合规划、前后台映射、退避重试规划)在
 * session-registry.ts(Seam B 测试);本文件只做副作用编排。
 */

import type { DiscoveredService, DiscoveryFailure } from "./discovery";
import { classifyProbeFailure, selectCandidates, serviceKey, type ServiceAssociations } from "./discovery-match";
import { discoveryRetryDelay } from "./discovery-lifecycle";
import type { AgentsResponse } from "./agent-contract";
import { NativeModules } from "react-native";
import {
  NetworkError,
  toErrorCode,
  toErrorStatus,
  type NetworkErrorCode,
} from "./i18n/errors";
import { agentsEventsUrl, devServerFallbackService, fetchAgents, preferredAddress, type RequestCredentials } from "./network";
import type { DeviceCredentials } from "./paired-instances";
import { startStream, type PinnedStreamHandle, type PinnedStreamError } from "pinned-stream";

const DISCOVERY_WAIT_MS = 6_000;
const AGENT_POLL_INTERVAL_MS = 3_000;

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

/** "live" = SSE 流驱动刷新;"polling" = 仅 3s 轮询降级。 */
export type StreamStatus = "live" | "polling";

export type AuthInvalidKind = "unauthorized" | "revoked";

export interface ConnectionSessionOptions {
  /** 本会话实例的凭据(构造时快照;重新配对由 provider 重建会话)。 */
  readonly credentials: DeviceCredentials;
  /** 跨会话共享的已验证 serviceKey → fingerprint 关联缓存。 */
  readonly associations: ServiceAssociations;
  /** 初始前后台状态;后续由 begin()/pause() 驱动。 */
  readonly foreground: boolean;
  /** 是否支持 SSE 长流(平台决策,注入以保持本模块无 RN 依赖)。 */
  readonly streamSupported: boolean;
  /** 探测/轮询观察到鉴权终态:该实例凭据已被 daemon 侧拒绝,由 provider
   *  移除该实例(其他实例的会话不受影响)。 */
  readonly onAuthInvalid: (kind: AuthInvalidKind) => void | Promise<void>;
  /** 任一可渲染状态(state/streamStatus)变化时通知。 */
  readonly onChanged: () => void;
}

function failureFrom(error: unknown, fallback: NetworkErrorCode) {
  return {
    phase: "failed" as const,
    code: toErrorCode(error, fallback),
    status: toErrorStatus(error),
  };
}

/**
 * 单实例连接会话。生命周期由 provider 驱动:
 *
 * - `begin()`:启动/重启(首次挂载、回前台、退避重试)。幂等:先清理
 *   旧探测/快照循环再重新匹配。
 * - `handleServices()/handleDiscoveryFailure()`:mDNS 发现事件分发。
 * - `pause()`:退后台——停轮询/SSE/重连;连接状态与数据保留。
 * - `stop()`:终止(provider 移除实例/卸载),之后一切回调静默。
 */
export class ConnectionSession {
  readonly fingerprint: string;
  private readonly credentials: DeviceCredentials;
  private readonly associations: ServiceAssociations;
  private readonly streamSupported: boolean;
  private readonly onAuthInvalid: ConnectionSessionOptions["onAuthInvalid"];
  private readonly onChanged: () => void;
  private foreground: boolean;
  private stopped = false;

  private services: readonly DiscoveredService[] = [];
  private state: ConnectionState = { phase: "discovering" };
  private streamStatus: StreamStatus = "polling";

  private requestController: AbortController | undefined;
  private discoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private connectInFlightKey: string | undefined;
  private selectedKey: string | undefined;

  /** 快照循环(轮询 + SSE)绑定的服务;断开时清空。 */
  private snapshotService: DiscoveredService | undefined;
  private pollingTimer: ReturnType<typeof setInterval> | undefined;
  private pollingInflight = false;
  private streamHandle: PinnedStreamHandle | undefined;
  private streamReconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private streamReconnectAttempt = 0;

  constructor(options: ConnectionSessionOptions) {
    this.credentials = options.credentials;
    this.fingerprint = options.credentials.fingerprint;
    this.associations = options.associations;
    this.foreground = options.foreground;
    this.streamSupported = options.streamSupported;
    this.onAuthInvalid = options.onAuthInvalid;
    this.onChanged = options.onChanged;
  }

  /** 该会话创建时的凭据快照(provider 的会话集合 reconcile 用)。 */
  get sessionCredentials(): DeviceCredentials {
    return this.credentials;
  }

  getState(): ConnectionState {
    return this.state;
  }

  getStreamStatus(): StreamStatus {
    return this.streamStatus;
  }

  /**
   * 启动/重启会话:重置探测状态(已连/探测中的服务作废),重新执行
   * 发现匹配。幂等——先清理全部旧定时器与循环。provider 在首次建会话、
   * 回前台、退避重试时调用。
   *
   * `foreground` 默认 true(回前台/重试路径都处于前台);冷启动于后台时
   * provider 显式传入 false——探测照常(发现驱动),但轮询与 SSE 不启,
   * 与既有 useConnectedSnapshot 的前台守卫一致。
   */
  begin(
    initialServices?: readonly DiscoveredService[],
    options?: { readonly foreground?: boolean },
  ): void {
    if (this.stopped) return;
    if (initialServices) this.services = initialServices;
    this.foreground = options?.foreground ?? true;
    this.requestController?.abort();
    this.requestController = undefined;
    this.connectInFlightKey = undefined;
    this.selectedKey = undefined;
    this.clearDiscoveryTimer();
    this.stopSnapshotLoop();
    this.setState({ phase: "discovering" });
    this.beginNotFoundCountdown();
    this.probeFromServices();
  }

  /** 退后台:停轮询/SSE/重连;状态与已连接数据保留,回前台由 begin() 恢复。 */
  pause(): void {
    if (this.stopped) return;
    this.foreground = false;
    this.stopSnapshotLoop();
  }

  /** 终止会话(provider 移除实例/卸载):此后一切异步回调静默。 */
  stop(): void {
    this.stopped = true;
    this.requestController?.abort();
    this.requestController = undefined;
    this.clearDiscoveryTimer();
    this.stopSnapshotLoop();
  }

  /** 供 provider 注入的非发现类失败(Android 本地网络权限被拒等)。 */
  failWith(code: NetworkErrorCode, status?: number): void {
    if (this.stopped) return;
    this.setState({ phase: "failed", code, status });
  }

  /**
   * mDNS 发现结果分发(全量快照)。防抖守卫(既有语义,防止发现重放触发
   * 探测风暴):已连接服务仍在发现集 → 不打断;探测中的候选仍在 → 不打断。
   * 其余情况重置匹配:重新按本实例 fingerprint 挑选候选探测。
   */
  handleServices(services: readonly DiscoveredService[]): void {
    if (this.stopped) return;
    this.services = services;
    const next = new Map(services.map((service) => [serviceKey(service), service] as const));
    const hadConnection = this.selectedKey !== undefined;
    const inFlightKey = this.connectInFlightKey;
    if (this.selectedKey && next.has(this.selectedKey)) return;
    if (inFlightKey && next.has(inFlightKey)) return;

    this.requestController?.abort();
    this.selectedKey = undefined;
    this.connectInFlightKey = undefined;

    const candidates = selectCandidates(services, this.fingerprint, this.associations);
    if (candidates.length === 0) {
      // 发现集中没有本实例的服务:此前有连接/在途探测才宣告 not_found,
      // 纯 discovering 阶段继续等 not_found 倒计时。
      if (hadConnection || inFlightKey) this.setState({ phase: "not_found" });
      return;
    }
    void this.connect(candidates);
  }

  /** mDNS 发现层失败(search/resolve):全部会话各自进入 failed,由 provider 退避重启发现。 */
  handleDiscoveryFailure(failure: DiscoveryFailure): void {
    if (this.stopped) return;
    this.requestController?.abort();
    this.requestController = undefined;
    this.selectedKey = undefined;
    this.clearDiscoveryTimer();
    this.setState({
      phase: "failed",
      code: failure.stage === "search" ? "discovery_search_failed" : "discovery_resolve_failed",
      status: failure.code,
    });
  }

  // ---------------------------------------------------------------------------
  // 发现匹配(pinned TLS 探测)
  // ---------------------------------------------------------------------------

  private probeFromServices(): void {
    if (this.stopped) return;
    const candidates = selectCandidates(this.services, this.fingerprint, this.associations);
    if (candidates.length === 0) return; // 保持 discovering,等 not_found 倒计时
    void this.connect(candidates);
  }

  private clearDiscoveryTimer(): void {
    if (this.discoveryTimer) {
      clearTimeout(this.discoveryTimer);
      this.discoveryTimer = undefined;
    }
  }

  /**
   * "仍未找到"倒计时:宽限期内发现结果可能陆续到达;到点仍无本实例
   * 候选时尝试 Metro dev 直连,否则宣告 not_found。
   */
  private beginNotFoundCountdown(): void {
    this.clearDiscoveryTimer();
    this.discoveryTimer = setTimeout(() => {
      this.discoveryTimer = undefined;
      if (this.stopped) return;
      if (this.connectInFlightKey) return; // 探测进行中,不打断
      const candidates = selectCandidates(this.services, this.fingerprint, this.associations);
      if (candidates.length > 0) return;
      const sourceCode = NativeModules.SourceCode as
        | { scriptURL?: string; getConstants?: () => { scriptURL?: string } }
        | undefined;
      const scriptURL = sourceCode?.getConstants?.().scriptURL ?? sourceCode?.scriptURL;
      const fallback = devServerFallbackService(scriptURL);
      if (fallback) {
        void this.connect([fallback]);
      } else {
        this.setState({ phase: "not_found" });
      }
    }, DISCOVERY_WAIT_MS);
  }

  /**
   * 按候选顺序探测连接,直至 pinned TLS 握手命中本实例的证书 fingerprint。
   * fingerprint_mismatch / 传输失败 → 换下一个候选;其余错误意味着 pin 已
   * 通过(daemon 返回的终态),按终态处理。全部候选未命中 → not_found。
   */
  private async connect(candidates: readonly DiscoveredService[]): Promise<void> {
    this.requestController?.abort();
    const controller = new AbortController();
    this.requestController = controller;
    this.clearDiscoveryTimer();

    const requestCredentials: RequestCredentials = {
      fingerprint: this.credentials.fingerprint,
      token: this.credentials.token,
    };
    let attemptCount = 0;
    let wrongDaemonCount = 0;
    let lastError: unknown;
    for (const service of candidates) {
      if (this.stopped || controller.signal.aborted) {
        this.connectInFlightKey = undefined;
        return;
      }
      const key = serviceKey(service);
      this.connectInFlightKey = key;
      attemptCount += 1;
      try {
        const data = await fetchAgents(service, controller.signal, requestCredentials);
        if (this.stopped || controller.signal.aborted) {
          this.connectInFlightKey = undefined;
          return;
        }
        // pinned TLS 握手成功 = fingerprint 匹配本实例,记录共享关联。
        this.associations[key] = this.fingerprint;
        this.connectInFlightKey = undefined;
        this.selectedKey = key;
        this.startSnapshotLoop(service);
        this.setState({ phase: "connected", service, data });
        return;
      } catch (error) {
        lastError = error;
        if (this.stopped || controller.signal.aborted) {
          this.connectInFlightKey = undefined;
          return;
        }
        const failureKind = classifyProbeFailure(error);
        if (failureKind === "wrong_daemon") {
          wrongDaemonCount += 1;
          continue;
        }
        if (failureKind === "unreachable") continue;
        this.connectInFlightKey = undefined;
        // terminal:pin 已通过,错误属于本实例。
        if (error instanceof NetworkError && (error.code === "unauthorized" || error.code === "revoked")) {
          await this.onAuthInvalid(error.code as AuthInvalidKind);
          return;
        }
        if (error instanceof NetworkError && error.code === "daemon_outdated") {
          this.setState({ phase: "daemon_outdated" });
          return;
        }
        if (error instanceof NetworkError && error.code === "app_outdated") {
          this.setState({ phase: "app_outdated" });
          return;
        }
        this.setState(failureFrom(error, "connect_failed"));
        return;
      }
    }
    this.connectInFlightKey = undefined;
    if (wrongDaemonCount === attemptCount && attemptCount > 0) {
      // 每个候选都指纹不匹配:LAN 内的 daemon 都不是本实例的。
      this.setState({ phase: "not_found" });
      return;
    }
    this.setState(failureFrom(lastError ?? new NetworkError("connect_failed"), "connect_failed"));
  }

  // ---------------------------------------------------------------------------
  // 连接快照保持:轮询降级 + pinned SSE 流(既有 useConnectedSnapshot 语义)
  // ---------------------------------------------------------------------------

  private startSnapshotLoop(service: DiscoveredService): void {
    this.stopSnapshotLoop();
    this.snapshotService = service;
    // 重连后重置:首个 SSE 事件到来前视为轮询降级。
    this.setStreamStatus("polling");
    this.startPolling();
    if (this.streamSupported && this.foreground) void this.openStream(service);
  }

  private stopSnapshotLoop(): void {
    this.stopPolling();
    this.stopStream();
    this.snapshotService = undefined;
    this.setStreamStatus("polling");
  }

  private async tick(): Promise<void> {
    const service = this.snapshotService;
    if (!service || this.pollingInflight) return;
    this.pollingInflight = true;
    try {
      const data = await fetchAgents(service, undefined, {
        fingerprint: this.credentials.fingerprint,
        token: this.credentials.token,
      });
      if (!this.stopped && this.snapshotService === service) {
        this.setState({ phase: "connected", service, data });
      }
    } catch (error) {
      // 过期 tick(snapshotService 已换/已停)全部静默,防止误删/误写状态。
      if (error instanceof NetworkError && (error.code === "unauthorized" || error.code === "revoked")) {
        if (!this.stopped && this.snapshotService === service) {
          await this.onAuthInvalid(error.code as AuthInvalidKind);
        }
      } else if (error instanceof NetworkError && error.code === "fingerprint_mismatch") {
        if (!this.stopped && this.snapshotService === service) {
          this.setState({ phase: "fingerprint_mismatch" });
        }
      } else if (error instanceof NetworkError && error.code === "daemon_outdated") {
        if (!this.stopped && this.snapshotService === service) {
          this.setState({ phase: "daemon_outdated" });
        }
      } else if (error instanceof NetworkError && error.code === "app_outdated") {
        if (!this.stopped && this.snapshotService === service) {
          this.setState({ phase: "app_outdated" });
        }
      }
      // 其他错误:静默——瞬时故障保留最后快照。
    } finally {
      this.pollingInflight = false;
    }
  }

  private startPolling(): void {
    if (this.pollingTimer || !this.foreground || this.stopped) return;
    this.pollingTimer = setInterval(() => {
      void this.tick();
    }, AGENT_POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
  }

  private stopStream(): void {
    this.clearStreamReconnect();
    if (this.streamHandle) {
      // stop() suppresses the stream's own onClose/onError (quietClose in Swift),
      // so calling it here won't re-enter handleStreamEnd.
      try {
        this.streamHandle.stop();
      } catch {
        // stop() is best-effort; never let it throw the caller.
      }
      this.streamHandle = undefined;
    }
  }

  private clearStreamReconnect(): void {
    if (this.streamReconnectTimer) {
      clearTimeout(this.streamReconnectTimer);
      this.streamReconnectTimer = undefined;
    }
  }

  private async openStream(service: DiscoveredService): Promise<void> {
    if (this.stopped || !this.foreground || this.snapshotService !== service) return;
    if (this.streamHandle) {
      try {
        this.streamHandle.stop();
      } catch {
        /* ignore */
      }
      this.streamHandle = undefined;
    }

    let handle: PinnedStreamHandle;
    try {
      const address = preferredAddress(service.addresses);
      if (!address) return;
      handle = startStream(
        agentsEventsUrl(address, service.port),
        this.credentials.fingerprint,
        this.credentials.token,
      );
    } catch (error) {
      const code = (error as PinnedStreamError | undefined)?.code;
      if (code === "unsupported_platform" || code === "invalid_url") return;
      this.scheduleStreamReconnect(service);
      return;
    }
    this.streamHandle = handle;

    handle.onEvent(() => {
      if (this.stopped || this.snapshotService !== service) return;
      this.clearStreamReconnect();
      this.streamReconnectAttempt = 0;
      this.stopPolling();
      this.setStreamStatus("live");
      void this.tick();
    });
    handle.onError(() => {
      if (this.stopped || this.snapshotService !== service) return;
      this.handleStreamEnd(service);
    });
    handle.onClose(() => {
      if (this.stopped || this.snapshotService !== service) return;
      this.handleStreamEnd(service);
    });
  }

  private handleStreamEnd(service: DiscoveredService): void {
    this.streamHandle = undefined;
    this.clearStreamReconnect();
    this.setStreamStatus("polling");
    if (this.foreground) this.startPolling();
    this.scheduleStreamReconnect(service);
  }

  private scheduleStreamReconnect(service: DiscoveredService): void {
    this.clearStreamReconnect();
    const delay = discoveryRetryDelay(this.streamReconnectAttempt);
    this.streamReconnectAttempt += 1;
    this.streamReconnectTimer = setTimeout(() => {
      this.streamReconnectTimer = undefined;
      if (!this.stopped && this.foreground && this.snapshotService === service) {
        void this.openStream(service);
      }
    }, delay);
  }

  // ---------------------------------------------------------------------------
  // 状态写入
  // ---------------------------------------------------------------------------

  private setState(next: ConnectionState): void {
    // 离开 connected 相位时停掉快照循环(轮询/SSE/重连):连接已断,
    // 继续刷新只会对已失效的服务发请求(既有 React effect cleanup 语义)。
    if (next.phase !== "connected" && this.snapshotService) this.stopSnapshotLoop();
    this.state = next;
    this.onChanged();
  }

  private setStreamStatus(next: StreamStatus): void {
    if (this.streamStatus === next) return;
    this.streamStatus = next;
    this.onChanged();
  }
}
