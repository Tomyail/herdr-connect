import type { Agent } from "./agent-contract";
import type { MessageKey } from "./i18n/messages";

/** Semantic color token carrying an agent's displayed status. */
export type StatusTone = "statusDotConnected" | "statusDot" | "danger" | "textMuted";

/**
 * Display-layer semantic status of an agent: the single classification of
 * `interaction_state` + `justCompleted` + `turn_outcome`. Everything the UI
 * derives from an agent's status (pill text/tone below, list status-group
 * filtering in agent-filter.ts) projects from this one mapping — never
 * re-implement the switch.
 *
 * `unknown` means the pane went back to a plain shell, so we substitute the
 * most accurate thing we know: a completion we just observed live
 * (`just_completed`), then the reported turn outcome, then plain `idle`.
 */
export type SemanticAgentStatus =
  | "working"
  | "blocked"
  | "ready_input"
  | "just_completed"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "idle";

/** Classify an agent into its display-layer semantic status. */
export function semanticAgentStatus(agent: Agent, justCompleted: boolean): SemanticAgentStatus {
  switch (agent.interaction_state) {
    case "working":
      return "working";
    case "blocked":
      return "blocked";
    case "ready_input":
      return "ready_input";
    case "unknown":
      if (justCompleted) return "just_completed";
      switch (agent.turn_outcome) {
        case "succeeded":
          return "succeeded";
        case "failed":
          return "failed";
        case "cancelled":
          return "cancelled";
        default:
          return "idle";
      }
  }
}

/**
 * What the status pill/dot says for an agent, derived from
 * {@link semanticAgentStatus}. Active states speak for themselves; the
 * technical "unknown" is never shown — it resolves to just-completed, the
 * turn outcome, or plain "idle".
 */
export function agentStatus(agent: Agent, justCompleted: boolean): { textKey: MessageKey; tone: StatusTone } {
  switch (semanticAgentStatus(agent, justCompleted)) {
    case "working":
      return { textKey: "interaction.working", tone: "statusDotConnected" };
    case "blocked":
      return { textKey: "interaction.blocked", tone: "danger" };
    case "ready_input":
      return { textKey: "interaction.ready_input", tone: "statusDot" };
    case "just_completed":
      return { textKey: "agents.row.justCompleted", tone: "statusDotConnected" };
    case "succeeded":
      return { textKey: "interaction.succeeded", tone: "statusDotConnected" };
    case "failed":
      return { textKey: "interaction.failed", tone: "danger" };
    case "cancelled":
      return { textKey: "interaction.cancelled", tone: "textMuted" };
    case "idle":
      return { textKey: "interaction.idle", tone: "textMuted" };
  }
}
