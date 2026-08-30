import assert from "node:assert/strict";
import test from "node:test";

import { parseScreenshotScene } from "./screenshot-fixtures";

test("screenshot launch options accept all deterministic scenes", () => {
  assert.equal(parseScreenshotScene("agents"), "agents");
  assert.equal(parseScreenshotScene("detail"), "detail");
  assert.equal(parseScreenshotScene("settings"), "settings");
  assert.equal(parseScreenshotScene("pairing"), undefined);
});
