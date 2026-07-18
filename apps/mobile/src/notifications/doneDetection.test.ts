import assert from "node:assert/strict";
import test from "node:test";

import type { DemoAgent } from "../demo-contract";
import { detectNewlyCompleted, indexAgents, isActive } from "./doneDetection";

function agent(source_id: string, overrides: Partial<DemoAgent> = {}): DemoAgent {
  return {
    source_id,
    display_name: source_id,
    revision: 1,
    interaction_state: "working",
    ...overrides,
  };
}

test("isActive: working and blocked are active; everything else is not", () => {
  assert.equal(isActive(agent("a", { interaction_state: "working" })), true);
  assert.equal(isActive(agent("a", { interaction_state: "blocked" })), true);
  assert.equal(isActive(agent("a", { interaction_state: "ready_input" })), false);
  assert.equal(isActive(agent("a", { interaction_state: "unknown" })), false);
  assert.equal(isActive(agent("a", { interaction_state: "unknown", turn_outcome: "succeeded" })), false);
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

test("detectNewlyCompleted: working -> unknown (plain shell) chimes — matches herdr desktop", () => {
  // This is the observed case: herdr's CLI reports the finished pane back as
  // unknown with no turn_outcome, but herdr's own desktop chime fires.
  const prev = indexAgents([agent("a", { interaction_state: "working" })]);
  const curr = [agent("a", { interaction_state: "unknown" })];
  assert.equal(detectNewlyCompleted(prev, curr).length, 1);
});

test("detectNewlyCompleted: blocked -> idle/unknown also chimes (herdr counts Blocked -> Idle as Done)", () => {
  const prev = indexAgents([agent("a", { interaction_state: "blocked" })]);
  assert.equal(detectNewlyCompleted(prev, [agent("a", { interaction_state: "ready_input" })]).length, 1);
  const prev2 = indexAgents([agent("a", { interaction_state: "blocked" })]);
  assert.equal(detectNewlyCompleted(prev2, [agent("a", { interaction_state: "unknown" })]).length, 1);
});

test("detectNewlyCompleted: staying inactive does not chime", () => {
  const prev = indexAgents([agent("a", { interaction_state: "ready_input" })]);
  assert.equal(detectNewlyCompleted(prev, [agent("a", { interaction_state: "ready_input" })]).length, 0);
  const prev2 = indexAgents([agent("a", { interaction_state: "unknown" })]);
  assert.equal(detectNewlyCompleted(prev2, [agent("a", { interaction_state: "unknown" })]).length, 0);
});

test("detectNewlyCompleted: only agents leaving active state chime among many", () => {
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

test("detectNewlyCompleted: active -> active (working <-> blocked) does not chime", () => {
  const prev = indexAgents([agent("a", { interaction_state: "working" })]);
  assert.equal(detectNewlyCompleted(prev, [agent("a", { interaction_state: "blocked" })]).length, 0);
  const prev2 = indexAgents([agent("a", { interaction_state: "blocked" })]);
  assert.equal(detectNewlyCompleted(prev2, [agent("a", { interaction_state: "working" })]).length, 0);
});

test("detectNewlyCompleted: agents missing from curr are ignored", () => {
  const prev = indexAgents([agent("a", { interaction_state: "working" })]);
  assert.equal(detectNewlyCompleted(prev, []).length, 0);
});

test("detectNewlyCompleted: a fresh working turn allows re-chiming on the next completion", () => {
  const prev1 = indexAgents([agent("a", { interaction_state: "working" })]);
  assert.equal(detectNewlyCompleted(prev1, [agent("a", { interaction_state: "unknown" })]).length, 1);

  const prev2 = indexAgents([agent("a", { interaction_state: "unknown" })]);
  assert.equal(detectNewlyCompleted(prev2, [agent("a", { interaction_state: "working" })]).length, 0);

  const prev3 = indexAgents([agent("a", { interaction_state: "working" })]);
  assert.equal(detectNewlyCompleted(prev3, [agent("a", { interaction_state: "unknown" })]).length, 1);
});
