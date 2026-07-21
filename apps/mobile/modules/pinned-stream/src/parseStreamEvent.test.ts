import assert from "node:assert/strict";
import test from "node:test";

import { parseStreamEvent } from "./parseStreamEvent";

test("parseStreamEvent parses a well-formed payload", () => {
  const event = parseStreamEvent(JSON.stringify({ cursor: "42", online: true }));
  assert.deepEqual(event, { cursor: "42", online: true });
});

test("parseStreamEvent accepts online:false", () => {
  const event = parseStreamEvent(JSON.stringify({ cursor: "7", online: false }));
  assert.deepEqual(event, { cursor: "7", online: false });
});

test("parseStreamEvent accepts an empty cursor string", () => {
  // daemon emits empty cursor when source errors (online:false, cursor:"").
  const event = parseStreamEvent(JSON.stringify({ cursor: "", online: false }));
  assert.deepEqual(event, { cursor: "", online: false });
});

test("parseStreamEvent returns null for malformed JSON", () => {
  assert.equal(parseStreamEvent("not json"), null);
  assert.equal(parseStreamEvent("{"), null);
  assert.equal(parseStreamEvent(""), null);
});

test("parseStreamEvent returns null for non-object JSON", () => {
  assert.equal(parseStreamEvent(JSON.stringify("string")), null);
  assert.equal(parseStreamEvent(JSON.stringify(42)), null);
  assert.equal(parseStreamEvent(JSON.stringify([1, 2])), null);
  assert.equal(parseStreamEvent("null"), null);
});

test("parseStreamEvent returns null when fields have wrong types", () => {
  assert.equal(parseStreamEvent(JSON.stringify({ cursor: 42, online: true })), null);
  assert.equal(parseStreamEvent(JSON.stringify({ cursor: "x", online: "yes" })), null);
  assert.equal(parseStreamEvent(JSON.stringify({ cursor: "x" })), null);
  assert.equal(parseStreamEvent(JSON.stringify({ online: true })), null);
  assert.equal(parseStreamEvent(JSON.stringify({ cursor: null, online: true })), null);
  assert.equal(parseStreamEvent(JSON.stringify({ cursor: "x", online: null })), null);
});

test("parseStreamEvent ignores extra fields but keeps the valid ones", () => {
  const event = parseStreamEvent(
    JSON.stringify({ cursor: "9", online: true, extra: "ignored", more: 1 }),
  );
  assert.deepEqual(event, { cursor: "9", online: true });
});

test("parseStreamEvent never throws on garbage input", () => {
  // The contract: malformed frames must be silently droppable, not fatal to
  // the stream loop. Ensure a variety of adversarial inputs return null rather
  // than throwing.
  const inputs = ["", "{", "}}}", "[1,2", "undefined", "\x00\x01", JSON.stringify(null)];
  for (const input of inputs) {
    assert.equal(parseStreamEvent(input), null, `input=${JSON.stringify(input)}`);
  }
});
