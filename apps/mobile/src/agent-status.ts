import type { Agent } from "./agent-contract";
import type { MessageKey } from "./i18n/messages";

/** Semantic color token carrying an agent's displayed status. */
export type StatusTone = "statusDotConnected" | "statusDot" | "danger" | "textMuted";

/**
 * What the status pill/dot says for an agent. Active states speak for
 * themselves; `unknown` means the pane went back to a plain shell, so we
 * substitute the most accurate thing we know: a completion we just observed
 * live, then the reported turn outcome, then plain "idle" — never the
 * technical "unknown".
 */
export function agentStatus(agent: Agent, justCompleted: boolean): { textKey: MessageKey; tone: StatusTone } {
  switch (agent.interaction_state) {
    case "working":
      return { textKey: "interaction.working", tone: "statusDotConnected" };
    case "blocked":
      return { textKey: "interaction.blocked", tone: "danger" };
    case "ready_input":
      return { textKey: "interaction.ready_input", tone: "statusDot" };
    case "unknown":
      if (justCompleted) return { textKey: "agents.row.justCompleted", tone: "statusDotConnected" };
      switch (agent.turn_outcome) {
        case "succeeded":
          return { textKey: "interaction.succeeded", tone: "statusDotConnected" };
        case "failed":
          return { textKey: "interaction.failed", tone: "danger" };
        case "cancelled":
          return { textKey: "interaction.cancelled", tone: "textMuted" };
        default:
          return { textKey: "interaction.idle", tone: "textMuted" };
      }
  }
}
