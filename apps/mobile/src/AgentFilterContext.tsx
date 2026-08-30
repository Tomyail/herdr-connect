/**
 * Agents 列表过滤的跨布局接线(issue #56 / #57)。
 *
 * 过滤选择(状态组 + workspace)属于每实例界面记忆(instance-ui-state 的
 * agentFilter 槽位),该 reducer 提升在 AppShell(窄屏导航树与宽屏
 * SplitLayout 之上)。列表页 AgentsScreenContent 是宽窄两树的共同挂载点,
 * 但挂载方(SplitLayout / Tab.Screen)不透传任意 props,因此用这个小
 * context 把「读当前过滤 + 写过滤」暴露给列表页——宽窄屏自动同源,行为
 * 一致。
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { type AgentListFilter } from "./agent-filter";

export interface AgentFilterValue {
  /** 当前(焦点实例的)列表过滤;两维皆空 = 不过滤。 */
  readonly agentFilter: AgentListFilter;
  /** 更新当前实例的过滤选择(写入 instance-ui-state 当前显示态)。 */
  readonly setAgentFilter: (filter: AgentListFilter) => void;
}

const AgentFilterContext = createContext<AgentFilterValue | undefined>(undefined);

export function AgentFilterProvider({
  agentFilter,
  setAgentFilter,
  children,
}: {
  agentFilter: AgentListFilter;
  setAgentFilter: (filter: AgentListFilter) => void;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ agentFilter, setAgentFilter }),
    [agentFilter, setAgentFilter],
  );
  return <AgentFilterContext.Provider value={value}>{children}</AgentFilterContext.Provider>;
}

export function useAgentFilter(): AgentFilterValue {
  const value = useContext(AgentFilterContext);
  if (!value) throw new Error("useAgentFilter must be used within an AgentFilterProvider");
  return value;
}
