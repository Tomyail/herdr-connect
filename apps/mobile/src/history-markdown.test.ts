import assert from "node:assert/strict";
import test from "node:test";

import { parseHistoryMarkdown } from "./history-markdown";

test("plain text with no markdown stays a single text span per line", () => {
  const lines = parseHistoryMarkdown("hello world");
  assert.deepEqual(lines, [{ kind: "text", spans: [{ kind: "text", value: "hello world" }] }]);
});

test("bold and inline code spans are recognized within a line", () => {
  const lines = parseHistoryMarkdown("do **not** run `rm -rf /`");
  assert.deepEqual(lines, [
    {
      kind: "text",
      spans: [
        { kind: "text", value: "do " },
        { kind: "bold", value: "not" },
        { kind: "text", value: " run " },
        { kind: "code", value: "rm -rf /" },
      ],
    },
  ]);
});

test("headers are recognized and stripped of their leading hashes", () => {
  const lines = parseHistoryMarkdown("# Summary\n## Details");
  assert.deepEqual(lines, [
    { kind: "header", text: "Summary" },
    { kind: "header", text: "Details" },
  ]);
});

test("fenced code blocks are rendered as code lines with fence markers dropped", () => {
  const lines = parseHistoryMarkdown("before\n```sh\necho hi\n```\nafter");
  assert.deepEqual(lines, [
    { kind: "text", spans: [{ kind: "text", value: "before" }] },
    { kind: "code", text: "echo hi" },
    { kind: "text", spans: [{ kind: "text", value: "after" }] },
  ]);
});

test("multi-line tool output keeps its literal line breaks, not reflowed into one paragraph", () => {
  const lines = parseHistoryMarkdown("⎿  first line\n   second line");
  assert.deepEqual(lines, [
    { kind: "text", spans: [{ kind: "text", value: "⎿  first line" }] },
    { kind: "text", spans: [{ kind: "text", value: "   second line" }] },
  ]);
});

test("a lone unterminated fence treats the rest of the text as code", () => {
  const lines = parseHistoryMarkdown("intro\n```\ntail one\ntail two");
  assert.deepEqual(lines, [
    { kind: "text", spans: [{ kind: "text", value: "intro" }] },
    { kind: "code", text: "tail one" },
    { kind: "code", text: "tail two" },
  ]);
});

test("a bare asterisk pair with no closing marker is left as plain text", () => {
  const lines = parseHistoryMarkdown("2 * 3 = 6");
  assert.deepEqual(lines, [{ kind: "text", spans: [{ kind: "text", value: "2 * 3 = 6" }] }]);
});

test("a stray closing fence from a truncated tail window does not desync the rest of the capture", () => {
  // `agent read --lines N` is a tail window: it can start already inside a
  // code block whose opening fence scrolled off-screen (only its closing "```"
  // is visible). A naive open/close toggle would then treat the *next*
  // tagged fence ("```sh") as closing that phantom block instead of opening
  // a new one, and everything after it would stay stuck in code mode for the
  // rest of the capture. A tagged fence always force-opens, so only the
  // small window between the stray close and the next real fence pair is
  // misclassified, not the entire remaining tail.
  const lines = parseHistoryMarkdown(["before the visible window", "```", "stray tail line", "```sh", "real code", "```", "after", "Model: x"].join("\n"));
  assert.deepEqual(lines, [
    { kind: "text", spans: [{ kind: "text", value: "before the visible window" }] },
    { kind: "code", text: "stray tail line" },
    { kind: "code", text: "real code" },
    { kind: "text", spans: [{ kind: "text", value: "after" }] },
    { kind: "text", spans: [{ kind: "text", value: "Model: x" }] },
  ]);
});

test("blank lines produce an empty text span, not an empty line list", () => {
  const lines = parseHistoryMarkdown("a\n\nb");
  assert.deepEqual(lines, [
    { kind: "text", spans: [{ kind: "text", value: "a" }] },
    { kind: "text", spans: [{ kind: "text", value: "" }] },
    { kind: "text", spans: [{ kind: "text", value: "b" }] },
  ]);
});
