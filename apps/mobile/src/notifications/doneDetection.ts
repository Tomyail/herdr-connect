import type { DemoAgent } from "../demo-contract";

/**
 * Completion detection for the done-chime, mirroring herdr's
 * `Working/Blocked -> Idle` semantics through the connect data model.
 *
 * An agent counts as "completed" right now when either:
 *  - `interaction_state` is `ready_input` (herdr reports `idle`), or
 *  - it carries a concrete `turn_outcome` (herdr reports `done`/`failed`/`cancelled`).
 *
 * `blocked` is intentionally NOT completed — that is herdr's "needs input"
 * case, which this app does not chime for (product decision: done only).
 */
export function isCompleted(agent: DemoAgent): boolean {
  if (agent.interaction_state === "ready_input") return true;
  return (
    agent.turn_outcome === "succeeded" ||
    agent.turn_outcome === "failed" ||
    agent.turn_outcome === "cancelled"
  );
}

/** Index agents by `source_id` to diff snapshots cheaply. */
export function indexAgents(agents: readonly DemoAgent[]): Map<string, DemoAgent> {
  const map = new Map<string, DemoAgent>();
  for (const agent of agents) map.set(agent.source_id, agent);
  return map;
}

/**
 * Return agents that transitioned from not-completed -> completed between two
 * snapshots. Agents absent from `prev` are treated as a baseline (no chime on
 * first sight), so the app only chimes on a transition observed live — never
 * for an agent that was already done when we first connected.
 */
export function detectNewlyCompleted(
  prev: ReadonlyMap<string, DemoAgent>,
  curr: readonly DemoAgent[],
): DemoAgent[] {
  const result: DemoAgent[] = [];
  for (const agent of curr) {
    const previous = prev.get(agent.source_id);
    if (!previous) continue; // first sight → baseline, no chime
    if (!isCompleted(previous) && isCompleted(agent)) {
      result.push(agent);
    }
  }
  return result;
}
