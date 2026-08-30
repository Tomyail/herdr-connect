/**
 * Paired-installation credentials, persisted via expo-secure-store (iOS
 * Keychain).
 *
 * 多实例模型（spec #51 / issue #53）：凭据不再存单一键位，而是按安装实例
 * 的 certificate fingerprint 键控的多条目集合——每个实例一条 Keychain 记录
 * （`herdr-connect.instance.<fingerprint>`），外加一个索引键（全部
 * fingerprint 列表）与一个活动实例键。键控/迁移/活动实例解析规则在纯模块
 * paired-instances.ts（Seam B 测试）；本文件只做 Keychain I/O 与迁移编排。
 *
 * 旧版单凭据键 `herdr-connect.paired-device` 在读取时自动迁移：读旧键 →
 * 合并入新模型 → 写入 → 删旧键。幂等可重入：迁移完成前崩溃，下次读取会
 * 以相同规则重放（同 fingerprint 已存在即跳过），不会产生重复条目。
 *
 * 每实例独立键位而非单一大 JSON：expo-secure-store 对单值有 ~2KB 建议
 * 上限，多条目键控不受实例数量影响。
 *
 * The token is a sensitive credential, so it MUST live in Keychain-backed
 * secure storage — never MMKV (which is for non-sensitive settings). 明文
 * token 只出现在配对响应与 Keychain 中，绝不写入日志。See
 * docs/security/lan-tls-pairing.md for the model.
 */

import * as SecureStore from "expo-secure-store";

import {
  migrateLegacyCredentials,
  parseInstanceRecordJson,
  removeInstance,
  resolveActiveInstance,
  setActiveInstance,
  upsertInstance,
  type DeviceCredentials,
  type PairedInstancesModel,
} from "./paired-instances";
export type { DeviceCredentials, PairedInstancesModel } from "./paired-instances";

/** 旧版单凭据键（只读迁移源，迁移后删除）。 */
const LEGACY_CREDENTIALS_KEY = "herdr-connect.paired-device";
/** 实例索引键：全部已配对 fingerprint 的 JSON 数组。 */
const INSTANCES_INDEX_KEY = "herdr-connect.paired-instances.index";
/** 活动实例键：当前活动实例的 fingerprint。 */
const ACTIVE_INSTANCE_KEY = "herdr-connect.paired-instances.active";

const instanceKeyFor = (fingerprint: string) => `herdr-connect.instance.${fingerprint}`;

const KEYCHAIN_OPTIONS = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
} as const;

function parseIndex(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((fp): fp is string => typeof fp === "string" && fp.length > 0);
  } catch {
    return [];
  }
}

/**
 * 读取完整模型。自愈：索引中缺失/损坏的条目被跳过（下次写入时从索引
 * 清除）；指向不存在实例的活动指针归一为 null（解析层有最近配对回退）。
 */
async function readModel(): Promise<PairedInstancesModel> {
  const fingerprints = parseIndex(await SecureStore.getItemAsync(INSTANCES_INDEX_KEY));
  const instances: Record<string, DeviceCredentials> = {};
  for (const fingerprint of fingerprints) {
    const raw = await SecureStore.getItemAsync(instanceKeyFor(fingerprint));
    const record = raw ? parseInstanceRecordJson(raw) : null;
    if (record && record.fingerprint === fingerprint) {
      instances[fingerprint] = record;
    }
  }
  const activeRaw = await SecureStore.getItemAsync(ACTIVE_INSTANCE_KEY);
  const activeFingerprint =
    typeof activeRaw === "string" && instances[activeRaw] ? activeRaw : null;
  return { activeFingerprint, instances };
}

/** 写入完整模型：逐条写实例、更新索引、同步活动指针、清理孤儿条目。 */
async function writeModel(model: PairedInstancesModel): Promise<void> {
  const previous = parseIndex(await SecureStore.getItemAsync(INSTANCES_INDEX_KEY));
  const fingerprints = Object.keys(model.instances);
  for (const fingerprint of fingerprints) {
    await SecureStore.setItemAsync(
      instanceKeyFor(fingerprint),
      JSON.stringify(model.instances[fingerprint]),
      KEYCHAIN_OPTIONS,
    );
  }
  for (const fingerprint of previous) {
    if (!(fingerprint in model.instances)) {
      await SecureStore.deleteItemAsync(instanceKeyFor(fingerprint));
    }
  }
  await SecureStore.setItemAsync(INSTANCES_INDEX_KEY, JSON.stringify(fingerprints), KEYCHAIN_OPTIONS);
  if (model.activeFingerprint) {
    await SecureStore.setItemAsync(ACTIVE_INSTANCE_KEY, model.activeFingerprint, KEYCHAIN_OPTIONS);
  } else {
    await SecureStore.deleteItemAsync(ACTIVE_INSTANCE_KEY);
  }
}

/**
 * 旧键迁移：合法旧凭据并入新模型后删除旧键；损坏的旧值（无法解析）直接
 * 删除——两种路径都收敛到“旧键不存在”，重复调用无副作用。
 */
async function migrateLegacyIfNeeded(model: PairedInstancesModel): Promise<PairedInstancesModel> {
  const legacyRaw = await SecureStore.getItemAsync(LEGACY_CREDENTIALS_KEY);
  if (legacyRaw === null) return model;
  const legacy = parseInstanceRecordJson(legacyRaw);
  const next = legacy ? migrateLegacyCredentials(model, legacy) : model;
  await writeModel(next);
  await SecureStore.deleteItemAsync(LEGACY_CREDENTIALS_KEY);
  return next;
}

/** 读取完整模型（含旧键迁移）。任何缺失/损坏都收敛为空模型，不抛出。 */
export async function loadPairedInstances(): Promise<PairedInstancesModel> {
  const model = await readModel();
  return migrateLegacyIfNeeded(model);
}

/**
 * Persist pairing credentials. 不再覆盖其他实例：按 fingerprint 键控
 * upsert，并把该实例设为活动实例（配对完成即连接它；重新配对同一实例
 * 为替换语义）。返回更新后的模型。
 */
export async function saveCredentials(credentials: DeviceCredentials): Promise<PairedInstancesModel> {
  const next = upsertInstance(await loadPairedInstances(), credentials, { activate: true });
  await writeModel(next);
  return next;
}

/**
 * 解析活动实例的凭据，或 `null`（从未配对 / 全部解绑）。旧调用方
 * （network.ts 的逐请求凭据加载）语义不变：拿到的就是“当前要连的实例”。
 */
export async function loadCredentials(): Promise<DeviceCredentials | null> {
  return resolveActiveInstance(await loadPairedInstances());
}

/**
 * 移除**指定实例**的凭据(issue #54 并行连接:会话观察到鉴权失效、或
 * unpair 解绑活动实例时使用,只解绑该实例,不影响其他会话)。返回更新
 * 后的模型;若移除的是活动实例,活动指针按 paired-instances.ts 规则回
 * 退。幂等:fingerprint 不存在时返回原模型且不写盘。
 */
export async function removeInstanceCredentials(fingerprint: string): Promise<PairedInstancesModel> {
  const model = await loadPairedInstances();
  const next = removeInstance(model, fingerprint);
  if (next !== model) await writeModel(next);
  return next;
}

/**
 * 切换活动实例(Settings 实例列表)。fingerprint 未知时返回 `null` 且不
 * 落盘;成功时返回更新后的模型。
 */
export async function selectActiveInstance(fingerprint: string): Promise<PairedInstancesModel | null> {
  const model = await loadPairedInstances();
  const next = setActiveInstance(model, fingerprint);
  if (next === model) return null;
  await writeModel(next);
  return next;
}
