/**
 * 并行连接会话集合的规划决策(Seam B,纯逻辑)。
 *
 * issue #54 的连接层多实例化:每个已配对安装实例对应一个独立连接会话,
 * 会话的存在与替换由三个纯决策驱动——
 *
 * - {@link planSessionSet}:实例集合(期望)↔ 现有会话集合 的 reconcile。
 *   新实例 → 建会话;实例移除 → 拆会话;同 fingerprint 重新配对(凭据
 *   内容变化)→ 拆旧建新。会话本身不再携带"活动/非活动"语义:所有会话
 *   平行长连,焦点只是 UI 渲染选择。
 * - {@link planForegroundTransition}:App 前后台事件 → 对全部 N 份会话的
 *   启停映射(beging 逐会话由 provider 分发)+ 是否重启 mDNS 发现。
 * - {@link planSessionRetry}:当前各会话相位 → 退避重试动作(哪些会话
 *   重启探测、是否 kick 发现)。并行下多个会话可能同时进入可重试相位,
 *   由 provider 统一节流,这里只做无状态决策。
 *
 * 副作用编排(创建/销毁 ConnectionSession、定时器、mDNS 调用)在
 * connection.tsx;本模块保持无依赖纯函数,可在 node:test 下运行。
 */

import type { DeviceCredentials } from "./paired-instances";

/** 会话集合 reconcile 结果:stop 先于 start 应用(替换场景两者同 fingerprint)。 */
export interface SessionSetPlan {
  /** 需要终止的会话(fingerprint 键)。 */
  readonly stop: readonly string[];
  /** 需要新建会话的实例凭据(含新建与替换)。 */
  readonly start: readonly DeviceCredentials[];
}

/**
 * 两条实例凭据是否等价(决定同 fingerprint 会话是否需要重建)。
 * 全字段比较:任何配对产物变化(deviceId/token/pairedAt/deviceName)都
 * 意味着一次重新配对,应替换会话以使用新凭据。
 */
function sameCredentials(a: DeviceCredentials, b: DeviceCredentials): boolean {
  return (
    a.fingerprint === b.fingerprint &&
    a.deviceId === b.deviceId &&
    a.token === b.token &&
    a.deviceName === b.deviceName &&
    a.pairedAt === b.pairedAt
  );
}

/**
 * 期望实例列表 → 现有会话集合(fingerprint → 该会话创建时的凭据快照)
 * 的会话集规划。确定性:stop 保持现有集合的键序,start 保持期望列表顺序。
 */
export function planSessionSet(
  desired: readonly DeviceCredentials[],
  existing: ReadonlyMap<string, DeviceCredentials>,
): SessionSetPlan {
  const stop: string[] = [];
  const start: DeviceCredentials[] = [];
  for (const [fingerprint, current] of existing) {
    const next = desired.find((instance) => instance.fingerprint === fingerprint);
    if (!next || !sameCredentials(next, current)) stop.push(fingerprint);
  }
  for (const instance of desired) {
    const current = existing.get(instance.fingerprint);
    if (!current || !sameCredentials(instance, current)) start.push(instance);
  }
  return { stop, start };
}

/** 单个会话的前后台动作:begin(前台运行)/ pause(后台暂停)/
 *  hold(维持现状)。 */
export type SessionLifecycleAction = "begin" | "pause" | "hold";

/** 前后台转换对会话集合与 mDNS 发现的整体规划。 */
export interface ForegroundPlan {
  /** 应用到全部 N 份会话的动作(平等对待,无焦点降级档位)。 */
  readonly sessionAction: SessionLifecycleAction;
  /** 是否需要重启 mDNS 发现(真正离开过 active 后回到 active 时,与既有
   *  shouldRestartDiscovery 语义一致)。 */
  readonly restartDiscovery: boolean;
}

/**
 * App 前后台事件 → 会话启停映射。
 *
 * - 退到 background:全部会话 pause(停轮询/流/重连),连接状态与已
 *   连接数据保留,回前台恢复(spec 决策:退后台才全停)。
 * - 短暂 inactive(iOS 下拉通知中心/系统弹窗等失焦,尚未真正退后台):
 *   hold 维持现状不断流;inactive→background 才真正全停。
 * - 回到 active:全部会话 begin(恢复探测/轮询/流)+ 重启发现(此前
 *   非 active);active→active 不产生转换事件,返回幂等结果。
 */
export function planForegroundTransition(previous: string, next: string): ForegroundPlan {
  const sessionAction: SessionLifecycleAction =
    next === "background" ? "pause" : next === "active" ? "begin" : "hold";
  const restartDiscovery = previous !== "active" && next === "active";
  return { sessionAction, restartDiscovery };
}

/** 可退避重试的会话相位:其余相位要么终态(需用户动作)要么正在推进。 */
const RETRYABLE_PHASES: ReadonlySet<string> = new Set(["not_found", "failed"]);

/** 退避重试规划:哪些会话重启探测、是否顺带重启 mDNS 发现。 */
export interface SessionRetryPlan {
  /** 处于可重试相位、需要重启探测的会话(fingerprint)。 */
  readonly restartProbes: readonly string[];
  /** 任一会话可重试时 kick 一次 mDNS 发现(对已连接会话无打扰:发现
   *  重放被会话的防抖守卫拦截)。 */
  readonly restartDiscovery: boolean;
  /** 是否有会话处于 discovering(探测/宽限倒计时推进中):此刻应挂起
   *  重试定时器但**保留**退避计数,否则 not_found → 重试 → discovering
   *  的循环会把退避永远重置在首档。计数只在全部会话落定时归零。 */
  readonly probing: boolean;
}

/**
 * 当前各会话相位 → 重试动作。无状态:同一输入恒同输出,节流(去抖、
 * 退避计数)由 provider 统一持有。
 */
export function planSessionRetry(
  phases: ReadonlyMap<string, string>,
): SessionRetryPlan {
  const restartProbes: string[] = [];
  let probing = false;
  for (const [fingerprint, phase] of phases) {
    if (RETRYABLE_PHASES.has(phase)) restartProbes.push(fingerprint);
    if (phase === "discovering") probing = true;
  }
  return {
    restartProbes,
    restartDiscovery: restartProbes.length > 0,
    probing,
  };
}
