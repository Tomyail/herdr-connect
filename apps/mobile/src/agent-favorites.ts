/**
 * Agent 收藏集合(issue #58,纯逻辑)。
 *
 * 收藏是纯客户端本地行为:不落服务端、不改协议,集合按实例隔离
 * (MMKV 持久化见 agent-favorites-storage.ts)。集合元素是
 * Agent.source_id——pane 关闭后 source_id 永不复用(agent-contract),
 * 因此「快照中已消失的 source_id」就是死引用,悬空收藏可以立即剔除,
 * 不存在误伤同名新 Agent 的风险。
 *
 * 集合形状:保序字符串数组(JSON 序列化稳定、MMKV 落盘友好);判定与
 * 剔除按收藏数 O(n) 足够(收藏数与 Agent 数同量级)。星标显示、长按
 * 菜单文案、过滤命中共用 isFavoriteSourceId 这一个判定,不建第二套。
 */

/** 收藏集合:source_id 的保序数组。 */
export type FavoriteSourceIds = readonly string[];

/** 单个 Agent 当前是否已收藏(星标 / 长按菜单 / 过滤共用的唯一判定)。 */
export function isFavoriteSourceId(favorites: FavoriteSourceIds, sourceId: string): boolean {
  return favorites.includes(sourceId);
}

/**
 * 切换收藏:未收藏 → 追加到尾部(重复追加幂等,集合内无重复);
 * 已收藏 → 移除(移除不存在的项不可达——调用方以同一判定分支)。
 */
export function toggleFavoriteSourceId(favorites: FavoriteSourceIds, sourceId: string): FavoriteSourceIds {
  if (!favorites.includes(sourceId)) return [...favorites, sourceId];
  return favorites.filter((candidate) => candidate !== sourceId);
}

/**
 * 悬空收藏剔除:快照中已消失的 source_id 从集合移除(pane 消失 → 收藏
 * 记录立即清理)。沿用悬空 workspace 剔除(pruneWorkspaces)的防御模式,
 * 并把「空快照不清理」守卫收进纯函数——空快照意味着断线/加载瞬间而非
 * pane 全关,此时清收藏会把整实例收藏误清,必须直通原引用。实例切换
 * 恢复记忆槽时由调用方(列表页)以新实例快照重跑本函数,同样剔除。
 */
export function pruneFavoriteSourceIds(
  favorites: FavoriteSourceIds,
  liveSourceIds: readonly string[],
): FavoriteSourceIds {
  if (liveSourceIds.length === 0 || favorites.length === 0) return favorites;
  const live = new Set(liveSourceIds);
  const next = favorites.filter((sourceId) => live.has(sourceId));
  return next.length === favorites.length ? favorites : next;
}

/**
 * 解析持久化字符串(MMKV 落盘的 JSON 数组)。非 JSON、非数组一律回到
 * 空集合(存储被外部破坏时静默降级,不抛错);非字符串/空串元素丢弃,
 * 重复项保序去重。`undefined`/空串输入 → 空集合。
 */
export function parseFavoriteSourceIds(raw: string | undefined): FavoriteSourceIds {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string" || item.length === 0 || seen.has(item)) continue;
    seen.add(item);
    ids.push(item);
  }
  return ids;
}

/** 序列化(空集合落盘为 `[]`,与「从未收藏」的键缺失态可区分)。 */
export function serializeFavoriteSourceIds(favorites: FavoriteSourceIds): string {
  return JSON.stringify(favorites);
}
