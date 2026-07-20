import assert from "node:assert/strict";
import test from "node:test";

import {
  discoveryRetryDelay,
  shouldRestartDiscovery,
} from "./discovery-lifecycle";

test("discovery restarts exactly when the app returns to the foreground", () => {
  assert.equal(shouldRestartDiscovery("active", "background"), false);
  assert.equal(shouldRestartDiscovery("background", "inactive"), false);
  assert.equal(shouldRestartDiscovery("inactive", "active"), true);
  assert.equal(shouldRestartDiscovery("background", "active"), true);
  assert.equal(shouldRestartDiscovery("active", "active"), false);
});

test("discovery retries quickly and caps its backoff", () => {
  assert.equal(discoveryRetryDelay(0), 1_000);
  assert.equal(discoveryRetryDelay(1), 2_000);
  assert.equal(discoveryRetryDelay(2), 4_000);
  assert.equal(discoveryRetryDelay(3), 8_000);
  assert.equal(discoveryRetryDelay(4), 15_000);
  assert.equal(discoveryRetryDelay(20), 15_000);
});
