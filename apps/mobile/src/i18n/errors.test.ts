import assert from "node:assert/strict";
import test from "node:test";

import { NETWORK_ERROR_CODES, NetworkError, toErrorCode, toErrorStatus } from "./errors";

test("NetworkError carries code and optional status", () => {
  const withStatus = new NetworkError("daemon_http", 500);
  assert.equal(withStatus.code, "daemon_http");
  assert.equal(withStatus.status, 500);
  assert.equal(withStatus.name, "NetworkError");
  assert.ok(withStatus instanceof Error);

  const withoutStatus = new NetworkError("connect_failed");
  assert.equal(withoutStatus.status, undefined);
});

test("toErrorCode returns the code for NetworkError and the fallback otherwise", () => {
  assert.equal(toErrorCode(new NetworkError("history_timeout"), "connect_failed"), "history_timeout");
  assert.equal(toErrorCode(new Error("boom"), "connect_failed"), "connect_failed");
  assert.equal(toErrorCode("a string", "connect_failed"), "connect_failed");
  assert.equal(toErrorCode(undefined, "connect_failed"), "connect_failed");
});

test("toErrorStatus extracts status only from NetworkError", () => {
  assert.equal(toErrorStatus(new NetworkError("daemon_http", 404)), 404);
  assert.equal(toErrorStatus(new NetworkError("connect_failed")), undefined);
  assert.equal(toErrorStatus(new Error("boom")), undefined);
  assert.equal(toErrorStatus(null), undefined);
});

test("NETWORK_ERROR_CODES has no duplicates", () => {
  assert.equal(new Set(NETWORK_ERROR_CODES).size, NETWORK_ERROR_CODES.length);
});
