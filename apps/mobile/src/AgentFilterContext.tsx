/**
 * Agents 列表状态过滤的跨布局接线(issue #56)。
 *
 * 过滤选择属于每实例界面记忆(instance-ui-state 的 statusFilter 槽位),
 * 该 reducer 提升在 AppShell(窄屏导航树与宽屏 SplitLayout 之上)。列表页
 * AgentsScreenContent 是宽窄两树的共同挂载点,但挂载方(SplitLayout /
 * Tab.Screen)不透传任意 props,因此用这个小 context 把「读当前过滤 +
 * 写过滤」暴露给列表页——宽窄屏自动同源,行为一致。
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { NO_STATUS_FILTER, type AgentStatusFilter } from "./agent-filter";

export interface AgentFilterValue {
  /** 当前(焦点实例的)状态过滤;空 = 不过滤。 */
  readonly statusFilter: AgentStatusFilter;
  /** 更新当前实例的过滤选择(写入 instance-ui-state 当前显示态)。 */
  readonly setStatusFilter: (filter: AgentStatusFilter) => void;
}

const AgentFilterContext = createContext<AgentFilterValue | undefined>(undefined);

export function AgentFilterProvider({
  statusFilter,
  setStatusFilter,
  children,
}: {
  statusFilter: AgentStatusFilter;
  setStatusFilter: (filter: AgentStatusFilter) => void;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ statusFilter, setStatusFilter }),
    [statusFilter, setStatusFilter],
  );
  return <AgentFilterContext.Provider value={value}>{children}</AgentFilterContext.Provider>;
}

export function useAgentFilter(): AgentFilterValue {
  const value = useContext(AgentFilterContext);
  if (!value) throw new Error("useAgentFilter must be used within an AgentFilterProvider");
  return value;
}
