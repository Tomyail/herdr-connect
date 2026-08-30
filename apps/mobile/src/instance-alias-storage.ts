/**
 * 实例别名的本机持久化(MMKV I/O)。
 *
 * 别名是非敏感的界面偏好,与语言/通知设置同住 `herdr-connect-prefs`
 * MMKV 实例(同 id 的 createMMKV 返回同一实例);敏感凭据仍在 Keychain
 * (credentials.ts),两者不混放。键位:`instanceAlias.<fingerprint>`。
 *
 * 规范化规则在纯模块 instance-alias.ts(normalizeInstanceAlias),本文件
 * 只做读写与清理;响应式读取由 UI 层的 useMMKVString(aliasKeyFor(fp),
 * instanceAliasStorage) 完成(useSyncExternalStore,同 key 变更自动重渲)。
 *
 * 生命周期:配对完成流程末尾写入(默认值见 defaultInstanceAlias),
 * Settings 可改写;忘记实例时随凭据一并清理(deleteInstanceAlias)。
 */

import { createMMKV } from "react-native-mmkv";

import { normalizeInstanceAlias } from "./instance-alias";

export const instanceAliasStorage = createMMKV({ id: "herdr-connect-prefs" });

/** 别名键(fingerprint 键控,与凭据键控规则一致)。 */
export const aliasKeyFor = (fingerprint: string) => `instanceAlias.${fingerprint}`;

/** 读取别名;未命名返回 `undefined`(展示层回退指纹尾 8 位)。 */
export function readInstanceAlias(fingerprint: string): string | undefined {
  const raw = instanceAliasStorage.getString(aliasKeyFor(fingerprint));
  return normalizeInstanceAlias(raw);
}

/**
 * 写入别名。`undefined` / 空白串 = 清除(回退默认展示),与
 * normalizeInstanceAlias 的"空即未命名"规则一致。
 */
export function writeInstanceAlias(fingerprint: string, alias: string | undefined): void {
  const normalized = normalizeInstanceAlias(alias);
  const key = aliasKeyFor(fingerprint);
  if (normalized) instanceAliasStorage.set(key, normalized);
  else instanceAliasStorage.remove(key);
}

/** 清除别名(忘记实例时随凭据一并清理,防泄漏)。 */
export function deleteInstanceAlias(fingerprint: string): void {
  instanceAliasStorage.remove(aliasKeyFor(fingerprint));
}
