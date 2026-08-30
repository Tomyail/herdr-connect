/**
 * Agents 列表过滤(issue #56 状态维 + issue #57 workspace 维 + issue #58
 * 收藏维,纯逻辑)。
 *
 * 过滤是三个独立维度的组合:
 *
 * - 状态维(四组:工作中 / 需要我(blocked + ready_input 合并)/ 已完成 /
 *   失败)。归组投影自 agent-status 的展示层语义状态
 *   (SemanticAgentStatus)——与状态 pill 同一口径,这里不重复实现
 *   interaction_state/turn_outcome 的解析,只做语义状态 → 组的合并。
 *   cancelled 与空闲不属任何组:任一组被选中时它们即被过滤掉。
 * - workspace 维:按 Agent.workspace_label 归一后的 key 分组(见
 *   workspaceKeyFor;空 label 归入"未命名 workspace")。
 * - 收藏维(issue #58):「仅看收藏」布尔开关,与状态/workspace 无关的
 *   全局修饰维(收藏的 idle/cancelled Agent 同样保留)。收藏集合由
 *   调用方传入(per-instance 存储,见 agent-favorites-storage),
 *   判定复用 isFavoriteSourceId——与星标/长按菜单同一口径。
 *
 * 组合语义:维度内 OR(多个状态组、多个 workspace 之间各自 OR),维度
 * 间 AND(状态 × workspace × 收藏 取交集)。任一维度未选择 = 该维
 * 直通(不过滤)。空选择 = 不过滤(列表与现状完全一致)。
 *
 * workspace 集合与全量计数由 enumerateWorkspaceOptions 从快照枚举——计数
 * 只依赖传入的 agents 列表,不与任何过滤选择联动(签名即契约)。
 */

import type { Agent } from "./agent-contract";
import { isFavoriteSourceId } from "./agent-favorites";
import { semanticAgentStatus } from "./agent-status";
import type { MessageKey } from "./i18n/messages";

/** 状态语义组标识(过滤选择状态维的取值域)。 */
export type AgentStatusGroup = "working" | "needsMe" | "completed" | "failed";

/** 组的展示顺序(chips 排列、选择集规范化的固定序)。 */
export const STATUS_GROUPS: readonly AgentStatusGroup[] = ["working", "needsMe", "completed", "failed"];

/** 组 → chip 文案键。 */
export const statusGroupLabelKey: Record<AgentStatusGroup, MessageKey> = {
  working: "agents.filter.group.working",
  needsMe: "agents.filter.group.needsMe",
  completed: "agents.filter.group.completed",
  failed: "agents.filter.group.failed",
};

/**
 * 未命名 workspace 在过滤选择中的 sentinel key。
 *
 * workspace_label 缺失或 trim 后为空时 Agent 归入这一组。真实 label 是
 * daemon 上报的目录名,以 NUL 控制字符开头几乎不可能出现;即便真出现,
 * 后果也只是与未命名组合并,不会丢数据。
 */
export const UNNAMED_WORKSPACE_KEY = "\u0000unnamed";

/**
 * Agents 列表过滤选择:状态组 + workspace + 收藏开关三个维度。
 * 状态/workspace 每维空数组 = 该维不过滤;favoritesOnly false = 收藏维
 * 不过滤;三维都空 = 完全不过滤。
 */
export interface AgentListFilter {
  readonly statusGroups: readonly AgentStatusGroup[];
  readonly workspaces: readonly string[];
  /** 「仅看收藏」开关:与另两维 AND 组合,关 = 直通。 */
  readonly favoritesOnly: boolean;
}

/** 默认不过滤。 */
export const NO_FILTER: AgentListFilter = { statusGroups: [], workspaces: [], favoritesOnly: false };

/** 过滤是否激活(任一维度有选择/开启)。 */
export function isFilterActive(filter: AgentListFilter): boolean {
  return filter.statusGroups.length > 0 || filter.workspaces.length > 0 || filter.favoritesOnly;
}

/** 过滤中已选中的可选项总数(激活态徽标用;收藏开关开启即计入)。 */
export function activeFilterChipCount(filter: AgentListFilter): number {
  return filter.statusGroups.length + filter.workspaces.length + (filter.favoritesOnly ? 1 : 0);
}

/**
 * Agent → 状态组。cancelled 与 idle 返回 undefined(不属任何组):
 * 任何组被选中时它们都会被过滤掉。
 */
export function statusGroupFor(agent: Agent, justCompleted: boolean): AgentStatusGroup | undefined {
  switch (semanticAgentStatus(agent, justCompleted)) {
    case "working":
      return "working";
    case "blocked":
    case "ready_input":
      return "needsMe";
    case "just_completed":
    case "succeeded":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
    case "idle":
      return undefined;
  }
}

/**
 * Agent → workspace key(过滤选择 workspace 维的取值域)。
 * workspace_label trim 后非空取该值(空白差异视为同一 workspace);
 * 缺失/全空白归入 UNNAMED_WORKSPACE_KEY("未命名 workspace"组)。
 */
export function workspaceKeyFor(agent: Agent): string {
  const label = agent.workspace_label?.trim() ?? "";
  return label.length > 0 ? label : UNNAMED_WORKSPACE_KEY;
}

/** 单个 Agent 是否通过过滤;三维都空恒通过(包括 idle/cancelled)。 */
export function matchesFilter(
  agent: Agent,
  justCompleted: boolean,
  filter: AgentListFilter,
  favoriteSourceIds: readonly string[] = [],
): boolean {
  // 状态维未选择 = 直通;选中任一组时 cancelled/idle 不属任何组,被排除。
  if (filter.statusGroups.length > 0) {
    const group = statusGroupFor(agent, justCompleted);
    if (!(group != null && filter.statusGroups.includes(group))) return false;
  }
  // workspace 维未选择 = 直通;选中则组内 OR 命中 key。
  if (filter.workspaces.length > 0 && !filter.workspaces.includes(workspaceKeyFor(agent))) {
    return false;
  }
  // 收藏维关闭 = 直通;开启则必须命中收藏集合(判定与星标/长按菜单
  // 共用 isFavoriteSourceId,收藏维不约束状态——收藏的 idle 也保留)。
  if (filter.favoritesOnly && !isFavoriteSourceId(favoriteSourceIds, agent.source_id)) {
    return false;
  }
  return true;
}

/**
 * 应用过滤到列表(维度内 OR、维度间 AND)。任一维度未激活时该维直通;
 * 三维都未激活时原样返回同一引用(调用方可安全作为 FlatList data,无
 * 多余拷贝/重渲);激活时保序过滤,"刚完成"瞬态由 completedIds 提供
 * (与状态 pill 的 justCompleted 同源),收藏维命中查 favoriteSourceIds
 * (当前实例的收藏集合)。
 */
export function filterAgents(
  agents: readonly Agent[],
  completedIds: ReadonlySet<string>,
  filter: AgentListFilter,
  favoriteSourceIds: readonly string[] = [],
): readonly Agent[] {
  if (!isFilterActive(filter)) return agents;
  return agents.filter((agent) =>
    matchesFilter(agent, completedIds.has(agent.source_id), filter, favoriteSourceIds),
  );
}

/**
 * 切换一个状态组的选中态,返回规范化后的过滤(固定组序、去重、workspace
 * 维原样保留),全部取消后与 NO_FILTER 同构(空数组 = 不过滤)。
 */
export function toggleStatusGroup(filter: AgentListFilter, group: AgentStatusGroup): AgentListFilter {
  const has = filter.statusGroups.includes(group);
  const next = has
    ? filter.statusGroups.filter((candidate) => candidate !== group)
    : [...filter.statusGroups, group];
  const selected = new Set(next);
  return {
    ...filter,
    statusGroups: STATUS_GROUPS.filter((candidate) => selected.has(candidate)),
  };
}

/**
 * 切换一个 workspace 的选中态(维度内多选 OR),workspace 维内按首次
 * 出现序去重追加、取消即移除;状态维原样保留。
 */
export function toggleWorkspace(filter: AgentListFilter, workspaceKey: string): AgentListFilter {
  const has = filter.workspaces.includes(workspaceKey);
  const workspaces = has
    ? filter.workspaces.filter((candidate) => candidate !== workspaceKey)
    : [...filter.workspaces, workspaceKey];
  return { ...filter, workspaces };
}

/** 切换「仅看收藏」开关;另两维原样保留(三维 AND,各自独立翻转)。 */
export function toggleFavoritesOnly(filter: AgentListFilter): AgentListFilter {
  return { ...filter, favoritesOnly: !filter.favoritesOnly };
}

/** workspace chip 的选项模型(枚举 + 全量计数)。 */
export interface WorkspaceOption {
  /** 过滤选择中的取值;未命名组为 UNNAMED_WORKSPACE_KEY。 */
  readonly key: string;
  /** 当前快照中的全量 Agent 计数(不随过滤选择联动)。 */
  readonly count: number;
  /** 未命名 workspace 组:显示文案由 UI 层走 i18n。 */
  readonly isUnnamed: boolean;
}

/**
 * 从快照枚举 workspace 选项:每个 workspace 的**全量计数**(函数只依赖
 * 传入的 agents,与任何过滤选择无关——调用方传全量列表即得全量计数)。
 * 排序:count 降序,平局按 key 字母序(稳定,不依赖输入顺序)。
 */
export function enumerateWorkspaceOptions(agents: readonly Agent[]): readonly WorkspaceOption[] {
  const counts = new Map<string, number>();
  for (const agent of agents) {
    const key = workspaceKeyFor(agent);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count, isUnnamed: key === UNNAMED_WORKSPACE_KEY }))
    .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * 把过滤选择中已不在快照枚举集合里的 workspace 剔除(防悬空选择:实例
 * 记忆槽恢复的旧选择、快照刷新后消失的 workspace)。无剔除时返回原引用。
 */
export function pruneWorkspaces(
  filter: AgentListFilter,
  liveWorkspaceKeys: readonly string[],
): AgentListFilter {
  if (filter.workspaces.length === 0) return filter;
  const live = new Set(liveWorkspaceKeys);
  const workspaces = filter.workspaces.filter((key) => live.has(key));
  if (workspaces.length === filter.workspaces.length) return filter;
  return { ...filter, workspaces };
}
