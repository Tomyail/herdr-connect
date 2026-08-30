/**
 * Agents 列表状态过滤(issue #56,纯逻辑)。
 *
 * 四个状态语义组:工作中 / 需要我(blocked + ready_input 合并)/ 已完成 /
 * 失败。归组投影自 agent-status 的展示层语义状态(SemanticAgentStatus)——
 * 与状态 pill 同一口径,这里不重复实现 interaction_state/turn_outcome 的
 * 解析,只做语义状态 → 组的合并。
 *
 * cancelled 与空闲不属任何组:任一组被选中时它们即被过滤掉;空选择 =
 * 不过滤(列表与现状完全一致)。
 */

import type { Agent } from "./agent-contract";
import { semanticAgentStatus } from "./agent-status";
import type { MessageKey } from "./i18n/messages";

/** 状态语义组标识(过滤选择的取值域)。 */
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

/** 过滤选择:选中的状态组;空数组 = 不过滤(全量)。 */
export interface AgentStatusFilter {
  readonly statusGroups: readonly AgentStatusGroup[];
}

/** 默认不过滤。 */
export const NO_STATUS_FILTER: AgentStatusFilter = { statusGroups: [] };

/** 过滤是否激活(任一组被选中)。 */
export function isStatusFilterActive(filter: AgentStatusFilter): boolean {
  return filter.statusGroups.length > 0;
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

/** 单个 Agent 是否通过过滤;空选择恒通过(包括 idle/cancelled)。 */
export function matchesStatusFilter(
  agent: Agent,
  justCompleted: boolean,
  filter: AgentStatusFilter,
): boolean {
  if (!isStatusFilterActive(filter)) return true;
  const group = statusGroupFor(agent, justCompleted);
  return group != null && filter.statusGroups.includes(group);
}

/**
 * 应用过滤到列表。不激活时原样返回同一引用(调用方可安全作为
 * FlatList data,无多余拷贝/重渲);激活时保序过滤,"刚完成"瞬态由
 * completedIds 提供(与状态 pill 的 justCompleted 同源)。
 */
export function filterAgents(
  agents: readonly Agent[],
  completedIds: ReadonlySet<string>,
  filter: AgentStatusFilter,
): readonly Agent[] {
  if (!isStatusFilterActive(filter)) return agents;
  return agents.filter((agent) => matchesStatusFilter(agent, completedIds.has(agent.source_id), filter));
}

/**
 * 切换一个组的选中态,返回规范化后的过滤(固定组序、去重),
 * 全部取消后与 NO_STATUS_FILTER 同构(空数组 = 不过滤)。
 */
export function toggleStatusGroup(filter: AgentStatusFilter, group: AgentStatusGroup): AgentStatusFilter {
  const has = filter.statusGroups.includes(group);
  const next = has
    ? filter.statusGroups.filter((candidate) => candidate !== group)
    : [...filter.statusGroups, group];
  const selected = new Set(next);
  return { statusGroups: STATUS_GROUPS.filter((candidate) => selected.has(candidate)) };
}
