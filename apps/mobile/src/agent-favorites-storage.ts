/**
 * Agent 收藏的本机持久化(MMKV I/O,issue #58)。
 *
 * 收藏与实例别名同为非敏感界面偏好,共用 `herdr-connect-prefs` MMKV
 * 实例(同 id 的 createMMKV 返回同一实例);敏感凭据仍在 Keychain,
 * 两者不混放。键位:`agentFavorites.<fingerprint>`(实例隔离,同别名
 * 键控规则)。不上服务端、不改协议。
 *
 * 规范化规则(解析容错/去重)在纯模块 agent-favorites.ts
 * (parseFavoriteSourceIds),本文件只做读写与清理;响应式读取由 UI 层
 * useMMKVString(favoritesKeyFor(fp), agentFavoritesStorage) 完成
 * (useSyncExternalStore,同 key 写入自动重渲)。
 *
 * 生命周期:长按 AgentRow 菜单写入;pane 消失时由列表页按快照剔除悬空
 * 项(pruneFavoriteSourceIds);忘记实例时随凭据/别名一并清理
 * (deleteAgentFavorites)。
 */

import { createMMKV } from "react-native-mmkv";

import { type FavoriteSourceIds, parseFavoriteSourceIds, serializeFavoriteSourceIds } from "./agent-favorites";

export const agentFavoritesStorage = createMMKV({ id: "herdr-connect-prefs" });

/** 收藏集合键(fingerprint 键控,与别名/凭据键控规则一致)。 */
export const favoritesKeyFor = (fingerprint: string) => `agentFavorites.${fingerprint}`;

/**
 * 无焦点实例时的哨兵 key:useMMKVString 需要 string key(不接受 null),
 * 未配对瞬间订阅这个永不写入的 key,读侧稳定返回空集合。
 */
export const FAVORITES_INACTIVE_KEY = "agentFavorites.__inactive__";

/** 读取收藏集合;未收藏/存储损坏返回空数组(parse 静默容错)。 */
export function readFavoriteSourceIds(fingerprint: string): FavoriteSourceIds {
  return parseFavoriteSourceIds(agentFavoritesStorage.getString(favoritesKeyFor(fingerprint)));
}

/** 整体覆写收藏集合(空集合也落盘:写入即触发同 key 订阅重渲)。 */
export function writeFavoriteSourceIds(fingerprint: string, favorites: FavoriteSourceIds): void {
  agentFavoritesStorage.set(favoritesKeyFor(fingerprint), serializeFavoriteSourceIds(favorites));
}

/** 清除收藏(忘记实例时随凭据/别名一并清理,防泄漏)。 */
export function deleteAgentFavorites(fingerprint: string): void {
  agentFavoritesStorage.remove(favoritesKeyFor(fingerprint));
}
