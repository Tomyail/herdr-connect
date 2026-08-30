/**
 * Agents 列表过滤(issue #56 状态维 + issue #57 workspace 维,纯逻辑)。
 *
 * 过滤是两个独立维度的组合:
 *
 * - 状态维(四组:工作中 / 需要我(blocked + ready_input 合并)/ 已完成 /
 *   失败)。归组投影自 agent-status 的展示层语义状态
 *   (SemanticAgentStatus)——与状态 pill 同一口径,这里不重复实现
 *   interaction_state/turn_outcome 的解析,只做语义状态 → 组的合并。
 *   cancelled 与空闲不属任何组:任一组被选中时它们即被过滤掉。
 * - workspace 维:按 Agent.workspace_label 归一后的 key 分组(见
 *   workspaceKeyFor;空 label 归入"未命名 workspace")。
 *
 * 组合语义:组内 OR(多个状态组、多个 workspace 之间各自 OR),组间 AND
 * (状态维 × workspace 维取交集)。任一维度未选择 = 该维直通(不过滤)。
 * 空选择 = 不过滤(列表与现状完全一致)。
 *
 * workspace 集合与全量计数由 enumerateWorkspaceOptions 从快照枚举——计数
 * 只依赖传入的 agents 列表,不与任何过滤选择联动(签名即契约)。
 */

import type { Agent } from "./agent-contract";
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
 * Agents 列表过滤选择:状态组 + workspace 两维度。
 * 每维空数组 = 该维不过滤;两维都空 = 完全不过滤。
 */
export interface AgentListFilter {
  readonly statusGroups: readonly AgentStatusGroup[];
  readonly workspaces: readonly string[];
}

/** 默认不过滤。 */
export const NO_FILTER: AgentListFilter = { statusGroups: [], workspaces: [] };

/** 过滤是否激活(任一维度有选择)。 */
export function isFilterActive(filter: AgentListFilter): boolean {
  return filter.statusGroups.length > 0 || filter.workspaces.length > 0;
}

/** 过滤中已选中的 chip 总数(激活态徽标用)。 */
export function activeFilterChipCount(filter: AgentListFilter): number {
  return filter.statusGroups.length + filter.workspaces.length;
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

/** 单个 Agent 是否通过过滤;两维都空恒通过(包括 idle/cancelled)。 */
export function matchesFilter(
  agent: Agent,
  justCompleted: boolean,
  filter: AgentListFilter,
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
  return true;
}

/**
 * 应用过滤到列表(组内 OR、组间 AND)。任一维度未激活时该维直通;两维
 * 都未激活时原样返回同一引用(调用方可安全作为 FlatList data,无多余
 * 拷贝/重渲);激活时保序过滤,"刚完成"瞬态由 completedIds 提供(与
 * 状态 pill 的 justCompleted 同源)。
 */
export function filterAgents(
  agents: readonly Agent[],
  completedIds: ReadonlySet<string>,
  filter: AgentListFilter,
): readonly Agent[] {
  if (!isFilterActive(filter)) return agents;
  return agents.filter((agent) => matchesFilter(agent, completedIds.has(agent.source_id), filter));
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
 * 切换一个 workspace 的选中态(组内多选 OR),workspace 维内按首次出现序
 * 去重追加、取消即移除;状态维原样保留。
 */
export function toggleWorkspace(filter: AgentListFilter, workspaceKey: string): AgentListFilter {
  const has = filter.workspaces.includes(workspaceKey);
  const workspaces = has
    ? filter.workspaces.filter((candidate) => candidate !== workspaceKey)
    : [...filter.workspaces, workspaceKey];
  return { ...filter, workspaces };
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
