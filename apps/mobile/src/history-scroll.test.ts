import assert from "node:assert/strict";
import test from "node:test";

import { isHistoryNearBottom } from "./history-scroll";

test("history follows while the viewport is at or close to the bottom", () => {
  assert.equal(isHistoryNearBottom({ contentHeight: 1_000, viewportHeight: 400, offsetY: 600 }), true);
  assert.equal(isHistoryNearBottom({ contentHeight: 1_000, viewportHeight: 400, offsetY: 520 }), true);
});

test("history stops following after the owner scrolls away from the bottom", () => {
  assert.equal(isHistoryNearBottom({ contentHeight: 1_000, viewportHeight: 400, offsetY: 519 }), false);
});

test("short history is treated as already at the bottom", () => {
  assert.equal(isHistoryNearBottom({ contentHeight: 200, viewportHeight: 400, offsetY: 0 }), true);
});
