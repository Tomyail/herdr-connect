import assert from "node:assert/strict";
import test from "node:test";

import { isHistoryNearBottom, isSameHistoryContent } from "./history-scroll";

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

test("history content changes even when Herdr returns the same revision", () => {
  const current = { revision: 0, text: "before", truncated: false };
  const next = { revision: 0, text: "newly sent text", truncated: false };

  assert.equal(isSameHistoryContent(current, next), false);
});

test("identical visible history content can skip a repeated poll response", () => {
  const current = { revision: 0, text: "unchanged", truncated: true };
  const next = { revision: 99, text: "unchanged", truncated: true };

  assert.equal(isSameHistoryContent(current, next), true);
});
