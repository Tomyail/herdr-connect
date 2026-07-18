import assert from "node:assert/strict";
import test from "node:test";

import type { DemoAgent } from "../demo-contract";
import { detectNewlyCompleted, indexAgents, isCompleted } from "./doneDetection";

function agent(source_id: string, overrides: Partial<DemoAgent> = {}): DemoAgent {
  return {
    source_id,
    display_name: source_id,
    revision: 1,
    interaction_state: "working",
    ...overrides,
  };
}

test("isCompleted: ready_input and any turn_outcome count as completed", () => {
  assert.equal(isCompleted(agent("a", { interaction_state: "ready_input" })), true);
  assert.equal(isCompleted(agent("a", { interaction_state: "unknown", turn_outcome: "succeeded" })), true);
  assert.equal(isCompleted(agent("a", { turn_outcome: "failed" })), true);
  assert.equal(isCompleted(agent("a", { turn_outcome: "cancelled" })), true);
});

test("isCompleted: working / blocked / bare-unknown are not completed", () => {
  assert.equal(isCompleted(agent("a", { interaction_state: "working" })), false);
  assert.equal(isCompleted(agent("a", { interaction_state: "blocked" })), false);
  assert.equal(isCompleted(agent("a", { interaction_state: "unknown" })), false);
  assert.equal(isCompleted(agent("a", { interaction_state: "working", turn_outcome: null })), false);
});

test("detectNewlyCompleted: empty prev is a baseline — nothing chimes", () => {
  const curr = [agent("a", { interaction_state: "ready_input" })];
  assert.deepEqual(detectNewlyCompleted(new Map(), curr), []);
});

test("detectNewlyCompleted: working -> ready_input chimes once", () => {
  const prev = indexAgents([agent("a", { interaction_state: "working" })]);
  const curr = [agent("a", { interaction_state: "ready_input" })];
  const result = detectNewlyCompleted(prev, curr);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.source_id, "a");
});

test("detectNewlyCompleted: working -> succeeded chimes once", () => {
  const prev = indexAgents([agent("a", { interaction_state: "working" })]);
  const curr = [agent("a", { interaction_state: "unknown", turn_outcome: "succeeded" })];
  assert.equal(detectNewlyCompleted(prev, curr).length, 1);
});

test("detectNewlyCompleted: staying completed does not chime", () => {
  const prev = indexAgents([agent("a", { interaction_state: "ready_input" })]);
  const curr = [agent("a", { interaction_state: "ready_input" })];
  assert.equal(detectNewlyCompleted(prev, curr).length, 0);
});

test("detectNewlyCompleted: only newly-completed agents among many chime", () => {
  const prev = indexAgents([
    agent("a", { interaction_state: "working" }),
    agent("b", { interaction_state: "ready_input" }),
    agent("c", { interaction_state: "working" }),
  ]);
  const curr = [
    agent("a", { interaction_state: "ready_input" }),
    agent("b", { interaction_state: "ready_input" }),
    agent("c", { interaction_state: "working" }),
  ];
  const result = detectNewlyCompleted(prev, curr);
  assert.deepEqual(result.map((a) => a.source_id), ["a"]);
});

test("detectNewlyCompleted: agents missing from curr are ignored", () => {
  const prev = indexAgents([agent("a", { interaction_state: "working" })]);
  assert.equal(detectNewlyCompleted(prev, []).length, 0);
});

test("detectNewlyCompleted: blocked is not a completion (no request chime)", () => {
  const prev = indexAgents([agent("a", { interaction_state: "working" })]);
  const curr = [agent("a", { interaction_state: "blocked" })];
  assert.equal(detectNewlyCompleted(prev, curr).length, 0);
});

test("detectNewlyCompleted: a fresh working turn allows re-chiming on the next completion", () => {
  const prev1 = indexAgents([agent("a", { interaction_state: "working" })]);
  const curr1 = [agent("a", { interaction_state: "ready_input" })];
  assert.equal(detectNewlyCompleted(prev1, curr1).length, 1);

  const prev2 = indexAgents(curr1);
  const curr2 = [agent("a", { interaction_state: "working" })];
  assert.equal(detectNewlyCompleted(prev2, curr2).length, 0);

  const prev3 = indexAgents(curr2);
  const curr3 = [agent("a", { interaction_state: "ready_input" })];
  assert.equal(detectNewlyCompleted(prev3, curr3).length, 1);
});

test("detectNewlyCompleted: unknown with turn_outcome -> unknown without does not un-complete", () => {
  // turn_outcome disappearing would be odd, but completion is edge-triggered:
  // once completed, only a fresh non-completed state resets the baseline.
  const prev = indexAgents([agent("a", { interaction_state: "unknown", turn_outcome: "succeeded" })]);
  const curr = [agent("a", { interaction_state: "unknown", turn_outcome: "succeeded" })];
  assert.equal(detectNewlyCompleted(prev, curr).length, 0);
});
