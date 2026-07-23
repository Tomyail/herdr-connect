import assert from "node:assert/strict";
import test from "node:test";

import {
  actionForContinuousModePress,
  actionForMicPress,
} from "./voice/continuousControls";

test("idle microphone starts the currently selected recording mode", () => {
  assert.equal(
    actionForMicPress({ continuousEnabled: false, phase: "idle", listening: false }),
    "toggleManualRecording",
  );
  assert.equal(
    actionForMicPress({ continuousEnabled: true, phase: "idle", listening: false }),
    "startContinuousSession",
  );
});

test("microphone exits every active continuous-session phase", () => {
  assert.equal(
    actionForMicPress({ continuousEnabled: true, phase: "listening", listening: true }),
    "stopContinuousSession",
  );
  assert.equal(
    actionForMicPress({ continuousEnabled: true, phase: "countingDown", listening: true }),
    "stopContinuousSession",
  );
  assert.equal(
    actionForMicPress({ continuousEnabled: true, phase: "waitingForAgent", listening: false }),
    "stopContinuousSession",
  );
});

test("microphone stops a manual recording and preserves review mode", () => {
  assert.equal(
    actionForMicPress({ continuousEnabled: false, phase: "idle", listening: true }),
    "toggleManualRecording",
  );
});

test("enabling continuous mode during manual recording does not touch recognition", () => {
  assert.equal(
    actionForContinuousModePress({ continuousEnabled: false, listening: true }),
    "enableContinuousMode",
  );
});

test("disabling continuous mode exits its session and only stops an active microphone", () => {
  assert.equal(
    actionForContinuousModePress({ continuousEnabled: true, listening: true }),
    "disableContinuousModeAndStop",
  );
  assert.equal(
    actionForContinuousModePress({ continuousEnabled: true, listening: false }),
    "disableContinuousMode",
  );
});
