import assert from "node:assert/strict";
import test from "node:test";

import { assertDaemonSupported, isDaemonOutdated, parseAgentsResponse } from "./agent-contract";
import { NetworkError } from "./i18n/errors";

test("parseAgentsResponse reads api_version and agent fields", () => {
  const parsed = parseAgentsResponse({
    api_version: 1,
    source_name: "herdr",
    source_online: true,
    refreshed_at: "2026-07-20T00:00:00Z",
    agents: [
      {
        source_id: "agent-1",
        display_name: "Agent One",
        revision: 3,
        interaction_state: "working",
        turn_outcome: null,
      },
    ],
  });

  assert.equal(parsed.api_version, 1);
  assert.equal(parsed.agents[0]?.source_id, "agent-1");
  assert.equal(parsed.agents[0]?.interaction_state, "working");
  assert.equal(parsed.agents[0]?.turn_outcome, null);
});

test("parseAgentsResponse rejects legacy demo_version payloads", () => {
  assert.throws(
    () => parseAgentsResponse({
      demo_version: 0,
      source_name: "herdr",
      source_online: true,
      refreshed_at: "2026-07-20T00:00:00Z",
      agents: [],
    }),
    (error) => error instanceof NetworkError && error.code === "response_missing",
  );
});

test("isDaemonOutdated rejects daemon API versions below minimum", () => {
  assert.equal(isDaemonOutdated(0), true);
  assert.equal(isDaemonOutdated(1), false);
  assert.equal(isDaemonOutdated(2), false);
  assert.equal(isDaemonOutdated(Number.NaN), true);
});

test("assertDaemonSupported throws daemon_outdated for old daemon API versions", () => {
  assert.throws(
    () => assertDaemonSupported(0),
    (error) => error instanceof NetworkError && error.code === "daemon_outdated",
  );
  assert.doesNotThrow(() => assertDaemonSupported(1));
});
