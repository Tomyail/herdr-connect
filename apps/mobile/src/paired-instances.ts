/**
 * 多实例凭据模型的纯逻辑（Seam B）。
 *
 * 模型形状：每条配对凭据按安装实例的 certificate fingerprint 键控
 * （一个 fingerprint = 一个 Installation 的配对结果），外加一个活动实例
 * 指针。键控规则、旧版单凭据迁移合并规则、活动实例解析/回退规则全部
 * 在本模块内以纯函数实现，由 paired-instances.test.ts 覆盖；Keychain
 * 读写（expo-secure-store）与迁移编排（读旧键 → 合并 → 写入 → 删旧键）
 * 在 credentials.ts。
 *
 * 安全性质保持：明文 token 只应出现在配对响应与本模块的数据结构里，
 * 最终落盘于 Keychain（credentials.ts）；本模块不做任何日志输出。
 */

/** 单个已配对安装实例的凭据。字段名保持稳定——旧版安装读取同样的形状。 */
export interface DeviceCredentials {
  /** base64url SHA-256 of the daemon's leaf certificate DER. Pinned on every request. */
  readonly fingerprint: string;
  /** Device id issued by `/v1/pair` (e.g. `dev_…`). */
  readonly deviceId: string;
  /** Per-device bearer token. Sent as `Authorization: Bearer <token>`. */
  readonly token: string;
  /** Device name submitted at pairing. Shown in Settings for recognition. */
  readonly deviceName: string;
  /** ISO timestamp of pairing. */
  readonly pairedAt: string;
}

/** 多实例凭据模型：instances 以 fingerprint 为键，activeFingerprint 指向活动实例。 */
export interface PairedInstancesModel {
  readonly activeFingerprint: string | null;
  readonly instances: Readonly<Record<string, DeviceCredentials>>;
}

export const EMPTY_PAIRED_INSTANCES: PairedInstancesModel = {
  activeFingerprint: null,
  instances: {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 校验并规范化一条实例凭据记录。
 *
 * 与旧版单凭据解析同等严格：五个字段必须是 string；fingerprint 与 token
 * 不接受空串（空 fingerprint 会破坏键控、空 token 必然无法鉴权）。形状
 * 不符返回 `null`，由调用方决定丢弃（自愈）策略。
 */
export function parseInstanceRecord(value: unknown): DeviceCredentials | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.fingerprint !== "string" ||
    typeof value.deviceId !== "string" ||
    typeof value.token !== "string" ||
    typeof value.deviceName !== "string" ||
    typeof value.pairedAt !== "string"
  ) {
    return null;
  }
  if (value.fingerprint.length === 0 || value.token.length === 0) return null;
  return {
    fingerprint: value.fingerprint,
    deviceId: value.deviceId,
    token: value.token,
    deviceName: value.deviceName,
    pairedAt: value.pairedAt,
  };
}

/** 解析 Keychain 中的单条 JSON 记录；非法 JSON 或非法形状都返回 `null`。 */
export function parseInstanceRecordJson(raw: string): DeviceCredentials | null {
  try {
    return parseInstanceRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** pairedAt 时间戳（毫秒）；无效值视为 0，保证排序全序确定。 */
function pairedAtTime(credentials: DeviceCredentials): number {
  const time = Date.parse(credentials.pairedAt);
  return Number.isNaN(time) ? 0 : time;
}

/**
 * 最近配对的实例。并列（相同 pairedAt 或均无效）时按 fingerprint 字典序
 * 取最小者，保证确定性——活动实例回退规则依赖这一点。
 */
export function mostRecentInstance(model: PairedInstancesModel): DeviceCredentials | null {
  const list = Object.values(model.instances);
  if (list.length === 0) return null;
  return list.reduce((best, current) => {
    const bestTime = pairedAtTime(best);
    const currentTime = pairedAtTime(current);
    if (currentTime !== bestTime) return currentTime > bestTime ? current : best;
    return current.fingerprint < best.fingerprint ? current : best;
  });
}

/**
 * 已配对实例列表，最近配对优先（Settings 展示顺序）。排序规则与
 * {@link mostRecentInstance} 一致，保证确定性。
 */
export function listInstances(model: PairedInstancesModel): DeviceCredentials[] {
  return Object.values(model.instances).sort((a, b) => {
    const at = pairedAtTime(a);
    const bt = pairedAtTime(b);
    if (bt !== at) return bt - at;
    return a.fingerprint < b.fingerprint ? -1 : 1;
  });
}

/**
 * 活动实例解析（含冷启动恢复）：
 *
 * 1. activeFingerprint 有效 → 返回该实例；
 * 2. activeFingerprint 缺失，或指向已不存在的实例（被移除/数据异常）→
 *    回退到最近配对的实例；
 * 3. 无任何实例 → `null`（未配对）。
 */
export function resolveActiveInstance(model: PairedInstancesModel): DeviceCredentials | null {
  const fingerprint = model.activeFingerprint;
  if (fingerprint && model.instances[fingerprint]) return model.instances[fingerprint];
  return mostRecentInstance(model);
}

/**
 * 按 fingerprint 键控插入/替换一条实例凭据。
 *
 * - 不同 fingerprint 共存（多实例核心不变量：不覆盖其他实例）；
 * - 相同 fingerprint 替换（重新配对同一实例 = 新凭据替换旧凭据，不产生重复条目）；
 * - 默认 `activate: true`：配对完成后该实例成为活动实例（配对流式的既有预期）；
 *   `activate: false` 保持现有活动指针不变。
 */
export function upsertInstance(
  model: PairedInstancesModel,
  credentials: DeviceCredentials,
  options?: { activate?: boolean },
): PairedInstancesModel {
  const activate = options?.activate ?? true;
  const instances = { ...model.instances, [credentials.fingerprint]: credentials };
  return {
    activeFingerprint: activate ? credentials.fingerprint : model.activeFingerprint,
    instances,
  };
}

/**
 * 移除一条实例凭据（本地解绑）。若移除的是活动实例，活动指针回退到最近
 * 配对的剩余实例；没有剩余实例则为 `null`。移除不存在的 fingerprint 是
 * 无操作（幂等）。
 */
export function removeInstance(
  model: PairedInstancesModel,
  fingerprint: string,
): PairedInstancesModel {
  if (!model.instances[fingerprint]) return model;
  const instances = { ...model.instances };
  delete instances[fingerprint];
  const fallback = mostRecentInstance({ activeFingerprint: null, instances });
  const activeFingerprint =
    model.activeFingerprint === fingerprint ? (fallback?.fingerprint ?? null) : model.activeFingerprint;
  return { activeFingerprint, instances };
}

/**
 * 切换活动实例。仅接受已存在的 fingerprint；未知 fingerprint 或与当前
 * 相同都返回原模型引用（调用方以此判定“无需切换”）。
 */
export function setActiveInstance(
  model: PairedInstancesModel,
  fingerprint: string,
): PairedInstancesModel {
  if (!model.instances[fingerprint] || model.activeFingerprint === fingerprint) return model;
  return { activeFingerprint: fingerprint, instances: model.instances };
}

/**
 * 旧版单凭据 → 多实例模型的迁移合并规则：
 *
 * - 旧凭据按其 fingerprint 并入 instances；若该 fingerprint 已存在则跳过
 *   （新模型中的条目由新代码写入，数据更新）；
 * - activeFingerprint 为空时，迁移项成为活动实例（升级前唯一的配对升级后
 *   仍是活动实例，连接行为与升级前一致）；
 * - 幂等：对同一输入重复应用结果不变（已存在即跳过）。
 */
export function migrateLegacyCredentials(
  model: PairedInstancesModel,
  legacy: DeviceCredentials,
): PairedInstancesModel {
  if (model.instances[legacy.fingerprint]) return model;
  const instances = { ...model.instances, [legacy.fingerprint]: legacy };
  return {
    activeFingerprint: model.activeFingerprint ?? legacy.fingerprint,
    instances,
  };
}
