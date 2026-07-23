import assert from "node:assert/strict";
import test from "node:test";

import {
  cReducer,
  INITIAL_STATE,
  isContinuousVoiceAgentReady,
} from "./voice/continuousReducer";

test("continuous voice treats every post-working input/completion state as ready to listen", () => {
  assert.equal(isContinuousVoiceAgentReady("ready_input"), true);
  assert.equal(isContinuousVoiceAgentReady("blocked"), true);
  assert.equal(isContinuousVoiceAgentReady("unknown"), true);
  assert.equal(isContinuousVoiceAgentReady("working"), false);
});

test("continuous voice still requires working before an unknown completion can restart listening", () => {
  let state = cReducer(INITIAL_STATE, { type: "USER_START" });
  state = cReducer(state, { type: "SILENCE_DETECTED" });
  state = cReducer(state, { type: "COUNTDOWN_TICK" });
  state = cReducer(state, { type: "COUNTDOWN_TICK" });
  state = cReducer(state, { type: "COUNTDOWN_TICK" });
  state = cReducer(state, { type: "COUNTDOWN_DONE" });

  // A stale inactive snapshot immediately after send must not restart listening.
  state = cReducer(state, { type: "AGENT_READY" });
  assert.equal(state.phase, "waitingForAgent");

  state = cReducer(state, { type: "AGENT_WORKING" });
  state = cReducer(state, { type: "AGENT_READY" });
  assert.equal(state.phase, "listening");
});
