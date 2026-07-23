import assert from "node:assert/strict";
import test from "node:test";

import { resolveComposerAction } from "./composerAction";

test("working Agent always exposes interrupt instead of send", () => {
  assert.deepEqual(
    resolveComposerAction({
      canInterrupt: true,
      canSend: true,
      interruptPending: false,
      sendPending: false,
      voiceListening: false,
    }),
    { mode: "interrupt", disabled: false, pending: false },
  );
});

test("interrupt remains the visible disabled action while its request is pending", () => {
  assert.deepEqual(
    resolveComposerAction({
      canInterrupt: true,
      canSend: true,
      interruptPending: true,
      sendPending: false,
      voiceListening: false,
    }),
    { mode: "interrupt", disabled: true, pending: true },
  );
});

test("non-working Agent preserves every send disable rule", () => {
  const base = {
    canInterrupt: false,
    interruptPending: false,
    sendPending: false,
  };
  assert.equal(
    resolveComposerAction({ ...base, canSend: false, voiceListening: false }).disabled,
    true,
  );
  assert.equal(
    resolveComposerAction({ ...base, canSend: true, voiceListening: true }).disabled,
    true,
  );
  assert.deepEqual(
    resolveComposerAction({ ...base, canSend: true, voiceListening: false }),
    { mode: "send", disabled: false, pending: false },
  );
});
