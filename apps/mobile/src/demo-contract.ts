export type InteractionState = "working" | "blocked" | "ready_input" | "unknown";
export type TurnOutcome = "succeeded" | "failed" | "cancelled";

export interface DemoAgent {
  source_id: string;
  display_name: string;
  workspace_label?: string;
  tab_label?: string;
  agent_name?: string;
  revision: number;
  interaction_state: InteractionState;
  turn_outcome?: TurnOutcome | null;
}

export interface DemoAgentsResponse {
  demo_version: number;
  source_name: string;
  source_online: boolean;
  refreshed_at: string;
  agents: DemoAgent[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asInteractionState(value: unknown): InteractionState {
  switch (value) {
    case "working":
    case "blocked":
    case "ready_input":
    case "unknown":
      return value;
    default:
      return "unknown";
  }
}

function asTurnOutcome(value: unknown): TurnOutcome | null | undefined {
  if (value === null) return null;
  switch (value) {
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return undefined;
  }
}

function parseAgent(value: unknown): DemoAgent {
  if (!isRecord(value)) throw new Error("Agent 数据格式无效");
  if (
    typeof value.source_id !== "string" ||
    typeof value.display_name !== "string" ||
    typeof value.revision !== "number"
  ) {
    throw new Error("Agent 缺少必要字段");
  }

  return {
    source_id: value.source_id,
    display_name: value.display_name,
    workspace_label: typeof value.workspace_label === "string" ? value.workspace_label : undefined,
    tab_label: typeof value.tab_label === "string" ? value.tab_label : undefined,
    agent_name: typeof value.agent_name === "string" ? value.agent_name : undefined,
    revision: value.revision,
    interaction_state: asInteractionState(value.interaction_state),
    turn_outcome: asTurnOutcome(value.turn_outcome),
  };
}

export function parseDemoAgentsResponse(value: unknown): DemoAgentsResponse {
  if (!isRecord(value)) throw new Error("daemon 响应格式无效");
  if (
    typeof value.demo_version !== "number" ||
    typeof value.source_name !== "string" ||
    typeof value.source_online !== "boolean" ||
    typeof value.refreshed_at !== "string" ||
    !Array.isArray(value.agents)
  ) {
    throw new Error("daemon 响应缺少必要字段");
  }

  return {
    demo_version: value.demo_version,
    source_name: value.source_name,
    source_online: value.source_online,
    refreshed_at: value.refreshed_at,
    agents: value.agents.map(parseAgent),
  };
}

export function interactionStateLabel(state: InteractionState): string {
  switch (state) {
    case "working":
      return "工作中";
    case "blocked":
      return "已阻塞";
    case "ready_input":
      return "等待输入";
    case "unknown":
      return "未知";
  }
}

export function turnOutcomeLabel(outcome?: TurnOutcome | null): string {
  switch (outcome) {
    case "succeeded":
      return "成功";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    case null:
    case undefined:
      return "未知";
  }
}
