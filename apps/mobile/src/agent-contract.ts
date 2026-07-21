import { NetworkError } from "./i18n/errors";

export type InteractionState = "working" | "blocked" | "ready_input" | "unknown";
export type TurnOutcome = "succeeded" | "failed" | "cancelled";

export interface Agent {
  source_id: string;
  display_name: string;
  workspace_label?: string;
  tab_label?: string;
  agent_name?: string;
  revision: number;
  interaction_state: InteractionState;
  turn_outcome?: TurnOutcome | null;
}

export interface AgentsResponse {
  api_version: number;
  source_name: string;
  source_online: boolean;
  refreshed_at: string;
  agents: Agent[];
}

/**
 * Minimum daemon API version this app can talk to. If a daemon reports a lower
 * `api_version` we surface a terminal `daemon_outdated` state instead of trying
 * to render data we may not understand. Bump only when a breaking daemon change
 * ships that this app can no longer tolerate.
 */
export const MIN_SUPPORTED_DAEMON_API_VERSION = 1;

/** Returns true when a daemon-reported api_version is too old for this app. */
export function isDaemonOutdated(apiVersion: number): boolean {
  return !Number.isFinite(apiVersion) || apiVersion < MIN_SUPPORTED_DAEMON_API_VERSION;
}

/** Throw the terminal protocol-version error when a daemon is too old. */
export function assertDaemonSupported(apiVersion: number): void {
  if (isDaemonOutdated(apiVersion)) throw new NetworkError("daemon_outdated");
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

function parseAgent(value: unknown): Agent {
  if (!isRecord(value)) throw new NetworkError("agent_invalid");
  if (
    typeof value.source_id !== "string" ||
    typeof value.display_name !== "string" ||
    typeof value.revision !== "number"
  ) {
    throw new NetworkError("agent_missing");
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

export function parseAgentsResponse(value: unknown): AgentsResponse {
  if (!isRecord(value)) throw new NetworkError("response_invalid");
  if (
    typeof value.api_version !== "number" ||
    typeof value.source_name !== "string" ||
    typeof value.source_online !== "boolean" ||
    typeof value.refreshed_at !== "string" ||
    !Array.isArray(value.agents)
  ) {
    throw new NetworkError("response_missing");
  }

  return {
    api_version: value.api_version,
    source_name: value.source_name,
    source_online: value.source_online,
    refreshed_at: value.refreshed_at,
    agents: value.agents.map(parseAgent),
  };
}
