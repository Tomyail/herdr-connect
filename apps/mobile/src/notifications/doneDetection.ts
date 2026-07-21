import type { Agent } from "../agent-contract";

/**
 * An agent is "active" — busy, or blocked waiting on input. These are the
 * states we chime *away from* when the agent leaves them.
 *
 * `unknown` is intentionally NOT active. herdr's CLI `agent_status` is
 * screen-detected and explicitly untrusted (see docs/daemon.md), and a
 * finished agent frequently reports back as `unknown` (e.g. the pane leaves
 * the agent viewer and becomes a plain shell — herdr's own `AgentState::Unknown`
 * is "Plain shell or unrecognized program"). So treating `working/blocked ->
 * anything else` as a completion is what matches herdr's desktop Done chime
 * in practice, instead of only the narrow `ready_input` / `turn_outcome` case.
 */
export function isActive(agent: Agent): boolean {
  return agent.interaction_state === "working" || agent.interaction_state === "blocked";
}

/** Index agents by `source_id` to diff snapshots cheaply. */
export function indexAgents(agents: readonly Agent[]): Map<string, Agent> {
  const map = new Map<string, Agent>();
  for (const agent of agents) map.set(agent.source_id, agent);
  return map;
}

/**
 * Return agents that transitioned out of an active state (working/blocked)
 * into a non-active one. Agents absent from `prev` are a baseline (no chime on
 * first sight), so we only chime on a transition observed live — never for an
 * agent that was already inactive when we first connected.
 */
export function detectNewlyCompleted(
  prev: ReadonlyMap<string, Agent>,
  curr: readonly Agent[],
): Agent[] {
  const result: Agent[] = [];
  for (const agent of curr) {
    const previous = prev.get(agent.source_id);
    if (!previous) continue; // first sight → baseline, no chime
    if (isActive(previous) && !isActive(agent)) {
      result.push(agent);
    }
  }
  return result;
}

/**
 * Return agents that transitioned back into an active state. Used to clear
 * their unseen-completion badge: once an agent is working again, "it just
 * finished" is no longer news.
 */
export function detectNewlyActive(
  prev: ReadonlyMap<string, Agent>,
  curr: readonly Agent[],
): Agent[] {
  const result: Agent[] = [];
  for (const agent of curr) {
    const previous = prev.get(agent.source_id);
    if (!previous) continue;
    if (!isActive(previous) && isActive(agent)) {
      result.push(agent);
    }
  }
  return result;
}
