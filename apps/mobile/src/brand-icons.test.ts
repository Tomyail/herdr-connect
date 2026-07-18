import assert from "node:assert/strict";
import test from "node:test";

import { brandGlyphForAgent } from "./brand-icons";

/** Every agent on https://herdr.dev/docs/agents/#supported-agents with a published vector mark. */
const HERDR_SUPPORTED = [
  "pi",
  "omp",
  "copilot",
  "devin",
  "kimi",
  "hermes",
  "qoder",
  "droid",
  "opencode",
  "kilocode",
  "mastra",
  "claude",
  "codex",
  "cursor",
  "amp",
  "grok",
  "antigravity",
  "kiro",
  "gemini",
  "cline",
];

test("every herdr-supported agent with a vector mark resolves to a glyph", () => {
  for (const name of HERDR_SUPPORTED) {
    assert.ok(brandGlyphForAgent(name), `expected a glyph for ${name}`);
  }
});

test("long needles match inside compound names", () => {
  assert.equal(brandGlyphForAgent("claude-code"), brandGlyphForAgent("claude"));
  assert.equal(brandGlyphForAgent("claudecode"), brandGlyphForAgent("claude"));
  assert.equal(brandGlyphForAgent("gemini-cli"), brandGlyphForAgent("gemini"));
  assert.equal(brandGlyphForAgent("GitHub Copilot"), brandGlyphForAgent("copilot"));
  assert.equal(brandGlyphForAgent("Kilo Code CLI"), brandGlyphForAgent("kilocode"));
  assert.equal(brandGlyphForAgent("mastracode"), brandGlyphForAgent("mastra"));
  assert.equal(brandGlyphForAgent("Kimi Code CLI"), brandGlyphForAgent("kimi"));
  assert.equal(brandGlyphForAgent("Hermes Agent"), brandGlyphForAgent("hermes"));
  assert.equal(brandGlyphForAgent("factory"), brandGlyphForAgent("droid"));
});

test("codex and gpt map to the openai blossom glyph", () => {
  assert.equal(brandGlyphForAgent("codex"), brandGlyphForAgent("openai"));
  assert.equal(brandGlyphForAgent("gpt-5"), brandGlyphForAgent("openai"));
});

test("short needles only match whole words", () => {
  assert.notEqual(brandGlyphForAgent("copilot"), brandGlyphForAgent("pi"));
  assert.equal(brandGlyphForAgent("pi-agent"), brandGlyphForAgent("pi"));
  assert.notEqual(brandGlyphForAgent("omp"), brandGlyphForAgent("pi"));
  assert.notEqual(brandGlyphForAgent("example"), brandGlyphForAgent("amp"));
  assert.equal(brandGlyphForAgent("example"), undefined);
});

test("matching is case-insensitive", () => {
  assert.equal(brandGlyphForAgent("Claude"), brandGlyphForAgent("claude"));
  assert.equal(brandGlyphForAgent("CODEX"), brandGlyphForAgent("codex"));
});

test("unknown or missing names return undefined for the fallback icon", () => {
  assert.equal(brandGlyphForAgent(undefined), undefined);
  assert.equal(brandGlyphForAgent(""), undefined);
  assert.equal(brandGlyphForAgent("bash"), undefined);
  assert.equal(brandGlyphForAgent("maki"), undefined);
});

test("non-default coordinate spaces carry their own viewBox", () => {
  assert.equal(brandGlyphForAgent("omp")?.viewBox, "12 16 40 40");
  assert.equal(brandGlyphForAgent("droid")?.viewBox, "0 0 100 100");
  assert.equal(brandGlyphForAgent("claude")?.viewBox, undefined);
});
