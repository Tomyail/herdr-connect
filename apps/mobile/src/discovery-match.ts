/**
 * 发现结果与已配对实例的匹配决策（Seam B，纯逻辑）。
 *
 * 背景：daemon 在 mDNS TXT 里广播 `fp=<fingerprint>`，但客户端使用的
 * @dawidzawada/bonjour-zeroconf 不暴露 TXT，发现结果里读不到 fingerprint。
 * 因此实例身份只能由 pinned TLS 连接验证：证书 fingerprint 不匹配的候选
 * 在握手期即失败（fingerprint_mismatch），匹配即证明该服务就是目标实例
 * 的 daemon。本模块提供两个纯决策，供 connection.tsx 的探测循环使用：
 *
 * - {@link selectCandidates}：给定当前发现列表、目标实例 fingerprint、
 *   已验证的 serviceKey→fingerprint 关联，产出按确定性顺序排列的待探测
 *   候选——已验证属于目标实例的排最前，未知的服务保持发现顺序参与探测，
 *   已验证属于其他实例的被排除。探测对全部候选执行后命中者唯一，结果
 *   不依赖发现顺序（消除“取第一个”的不确定行为）。
 * - {@link classifyProbeFailure}：把一次探测请求的失败分类为
 *   wrong_daemon（证书指纹不匹配 → 换下一个候选）、unreachable（传输层
 *   失败 → 换下一个候选）或 terminal（TLS pin 已通过、错误来自目标实例
 *   → 终止探测并上抛）。
 */

import type { DiscoveredService } from "./discovery";
import { NetworkError, type NetworkErrorCode } from "./i18n/errors";
import type { PinnedHost } from "./paired-instances";

/** 已通过 pinned TLS 连接验证的 serviceKey → fingerprint 关联（会话内缓存）。 */
export type ServiceAssociations = Record<string, string>;

/**
 * 发现服务的稳定键。与 network.ts 的 `serviceKey` 语义一致；此处独立
 * 实现以保持模块纯净（可在 node:test 下运行，不引入原生依赖）。
 */
export function serviceKey(service: DiscoveredService): string {
  return `${service.name}|${service.type}|${service.domain}`;
}

/**
 * 为目标实例挑选待探测候选，按以下确定性顺序：
 *
 * 1. 已验证关联到目标实例 fingerprint 的服务（最快路径，无需再探测）；
 * 2. 尚未验证的服务（保持传入顺序）；
 * 3. 已验证属于其他实例的服务被排除。
 */
export function selectCandidates(
  services: readonly DiscoveredService[],
  activeFingerprint: string,
  associations: ServiceAssociations,
): DiscoveredService[] {
  const associated: DiscoveredService[] = [];
  const unknown: DiscoveredService[] = [];
  for (const service of services) {
    const associatedFingerprint = associations[serviceKey(service)];
    if (associatedFingerprint === activeFingerprint) {
      associated.push(service);
    } else if (associatedFingerprint === undefined) {
      unknown.push(service);
    }
    // 关联到其他 fingerprint：已验证的外来实例，排除。
  }
  return [...associated, ...unknown];
}

/** 固定地址合成服务的 name 前缀；与真实 mDNS 服务名（daemon 主机名）不会冲突。 */
const PINNED_SERVICE_PREFIX = "pinned-host:";

/**
 * 把 `pair --host` 指定的地址合成为一个 {@link DiscoveredService}，让它
 * 走与 mDNS 候选完全相同的 pinned TLS 探测路径（指纹仍是唯一信任决策）。
 */
export function pinnedService(pinned: PinnedHost): DiscoveredService {
  return {
    name: `${PINNED_SERVICE_PREFIX}${pinned.host}`,
    type: "_herdr-connect._tcp.",
    domain: "local.",
    hostName: pinned.host,
    addresses: [pinned.host],
    port: pinned.port,
    txt: {},
  };
}

/**
 * 探测候选顺序：有固定地址时它排第一（`--host` 是显式覆盖），mDNS 候选
 * 作为其后的回退——固定地址不可达（如 Tailscale 断开）时仍能经局域网连上。
 * 没有固定地址时与 {@link selectCandidates} 完全一致。
 */
export function orderCandidates(
  services: readonly DiscoveredService[],
  activeFingerprint: string,
  associations: ServiceAssociations,
  pinned: PinnedHost | undefined,
): DiscoveredService[] {
  const discovered = selectCandidates(services, activeFingerprint, associations);
  return pinned ? [pinnedService(pinned), ...discovered] : discovered;
}

/** 某个 serviceKey 是否是固定地址（pinnedHost）合成服务的 key。 */
export function isPinnedServiceKey(key: string, pinned: PinnedHost | undefined): boolean {
  return pinned !== undefined && key === serviceKey(pinnedService(pinned));
}

/**
 * 候选列表中是否存在 `knownKeys` 不包含的服务——即一次探测发起之后，新
 * 发现快照是否带来了真正新的信息。供固定地址探测在途时决定是否要用
 * 扩充后的候选列表重启探测，而不是对每次快照都重启（避免探测风暴）。
 */
export function hasUnknownCandidate(
  candidates: readonly DiscoveredService[],
  knownKeys: ReadonlySet<string> | undefined,
): boolean {
  return candidates.some((service) => !knownKeys?.has(serviceKey(service)));
}

export type ProbeFailureKind =
  /** 证书 fingerprint 不匹配——该服务不是目标实例的 daemon，换下一个候选。 */
  | "wrong_daemon"
  /** 传输层失败（超时/TLS 未完成/无可用地址）——无法判定身份，换下一个候选。 */
  | "unreachable"
  /** TLS pin 已通过、错误来自目标实例（鉴权/版本/HTTP/响应格式）——终止探测。 */
  | "terminal";

/** 传输层失败码：请求没有到达“可验证证书”的阶段，不能据此排除候选。 */
const UNREACHABLE_CODES: ReadonlySet<NetworkErrorCode> = new Set([
  "no_address",
  "daemon_timeout",
  "daemon_tls",
]);

/** 把一次探测失败分类为探测循环的动作信号。非 NetworkError 一律 terminal。 */
export function classifyProbeFailure(error: unknown): ProbeFailureKind {
  if (!(error instanceof NetworkError)) return "terminal";
  if (error.code === "fingerprint_mismatch") return "wrong_daemon";
  if (UNREACHABLE_CODES.has(error.code)) return "unreachable";
  return "terminal";
}
