/**
 * 实例别名的纯决策(issue #55,Seam B)。
 *
 * 别名是纯客户端概念:不进配对协议、不进 daemon,只存在本机 MMKV
 * (instance-alias-storage.ts 负责 I/O)。本模块决定三件事:
 *
 * - 默认别名怎么来:配对完成流程末尾预填的值,按"mDNS 服务名 → mDNS
 *   hostname(剥 .local 后缀)→ QR payload 首个可达地址 → 指纹尾 8 位"
 *   的顺序回退——扫码那一刻 mDNS 往往还没解析出新实例,QR hosts 是主要
 *   来源,指纹回退保证永远有值。
 * - 用户输入怎么规范化:trim 后为空视为"未命名"(undefined),展示层回退
 *   到指纹尾 8 位,而不是存一个空串。
 * - 展示标签怎么解析:有别名用别名,无别名用 `…<指纹尾8位>`(与 #53 的
 *   Settings 实例识别符一致)。
 *
 * 无 RN/存储依赖,可在 node:test 下运行(见 instance-alias.test.ts)。
 */

/** mDNS hostname 的 `.local.` / `.local` 后缀(大小写不敏感)。 */
const LOCAL_SUFFIX = /\.local\.?$/i;

/**
 * 剥掉 mDNS hostname 的 `.local.` 后缀(`MacBook-Pro.local.` →
 * `MacBook-Pro`)。无后缀或尾部只有孤点时原样返回(只动 mDNS 后缀,
 * 不吞一般 FQDN 的域部分)。
 */
export function stripLocalSuffix(hostName: string): string {
  const trimmed = hostName.trim();
  if (!trimmed) return trimmed;
  return trimmed.replace(LOCAL_SUFFIX, "") || trimmed;
}

/**
 * 规范化用户输入的别名:trim;空(或全空白)→ `undefined`(未命名,
 * 展示层回退指纹尾 8 位)。长度上限 64:纯客户端标签,无需与服务端
 * device_name 的 100 字符上限对齐,取一个防止滥用的合理值。
 */
export function normalizeInstanceAlias(raw: string | undefined | null): string | undefined {
  const value = (raw ?? "").trim();
  if (value.length === 0) return undefined;
  return value.length > 64 ? value.slice(0, 64) : value;
}

/** 无别名时的展示回退:`…` + 指纹尾 8 位(#53 Settings 既有识别符)。 */
export function fallbackInstanceLabel(fingerprint: string): string {
  return `…${fingerprint.slice(-8)}`;
}

/**
 * 展示标签:别名优先,未命名回退指纹尾 8 位。切换器、Settings 实例行、
 * Alert 标题统一走这里,保证同一实例在所有 UI 位置显示一致。
 */
export function displayInstanceLabel(alias: string | undefined, fingerprint: string): string {
  return alias ?? fallbackInstanceLabel(fingerprint);
}

/** 默认别名的候选来源(全部可缺省,按优先级取第一个可用)。 */
export interface DefaultAliasHints {
  /** mDNS 服务实例名(发现服务名,如 `MacBook-Pro`)。 */
  readonly serviceName?: string;
  /** mDNS hostname(如 `MacBook-Pro.local.`)。 */
  readonly hostName?: string;
  /** QR payload 的可达地址列表(`hosts`,IPv4 优先)。 */
  readonly qrHosts?: readonly string[];
  /** 配对实例的 certificate fingerprint(最终回退)。 */
  readonly fingerprint: string;
}

/**
 * 配对完成流程末尾的默认别名。优先级:
 *
 * 1. mDNS 服务名(发现结果,最能代表"这台机器");
 * 2. mDNS hostname(剥 `.local.` 后缀);
 * 3. QR payload 首个非空 host(扫码那一刻 mDNS 通常尚未解析出该实例,
 *    这是实际上的主要来源——LAN IP 比指纹好认);
 * 4. 指纹尾 8 位(永远可用,但只保证"有值")。
 *
 * 候选值同样经过 trim;重复配对同一实例时,调用方应优先预填既有别名,
 * 仅在没有时才取本函数的结果(见 PairingScreen)。
 */
export function defaultInstanceAlias(hints: DefaultAliasHints): string {
  const serviceName = normalizeInstanceAlias(hints.serviceName);
  if (serviceName) return serviceName;
  const hostName = normalizeInstanceAlias(hints.hostName);
  if (hostName) return stripLocalSuffix(hostName);
  const qrHost = hints.qrHosts?.find((host) => typeof host === "string" && host.trim().length > 0);
  if (qrHost) return qrHost.trim();
  return fallbackInstanceLabel(hints.fingerprint);
}
