import assert from "node:assert/strict";
import test from "node:test";

import { playCompletionSound } from "./doneSoundPlayback";

test("playCompletionSound restores the playback audio mode before starting the chime", async () => {
  const calls: string[] = [];
  const player = {
    seekTo(position: number) {
      calls.push(`seek:${position}`);
    },
    play() {
      calls.push("play");
    },
  };

  await playCompletionSound(player, async () => {
    calls.push("restore:start");
    await Promise.resolve();
    calls.push("restore:done");
  });

  assert.deepEqual(calls, ["restore:start", "restore:done", "seek:0", "play"]);
});
