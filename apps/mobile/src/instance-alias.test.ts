import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultInstanceAlias,
  displayInstanceLabel,
  fallbackInstanceLabel,
  normalizeInstanceAlias,
  stripLocalSuffix,
} from "./instance-alias";

// ---------------------------------------------------------------------------
// normalizeInstanceAlias —— 用户输入规范化
// ---------------------------------------------------------------------------

test("normalizeInstanceAlias trims surrounding whitespace", () => {
  assert.equal(normalizeInstanceAlias("  Studio Mac  "), "Studio Mac");
});

test("normalizeInstanceAlias treats blank input as unnamed (undefined)", () => {
  assert.equal(normalizeInstanceAlias(""), undefined);
  assert.equal(normalizeInstanceAlias("   "), undefined);
  assert.equal(normalizeInstanceAlias(undefined), undefined);
  assert.equal(normalizeInstanceAlias(null), undefined);
});

test("normalizeInstanceAlias caps length at 64 characters", () => {
  const long = "a".repeat(80);
  const normalized = normalizeInstanceAlias(long);
  assert.ok(normalized);
  assert.equal(normalized.length, 64);
});

// ---------------------------------------------------------------------------
// stripLocalSuffix —— mDNS hostname 的 .local 后缀剥离
// ---------------------------------------------------------------------------

test("stripLocalSuffix removes the trailing .local. of an mDNS hostname", () => {
  assert.equal(stripLocalSuffix("MacBook-Pro.local."), "MacBook-Pro");
  assert.equal(stripLocalSuffix("MacBook-Pro.local"), "MacBook-Pro");
});

test("stripLocalSuffix is case-insensitive and ignores surrounding whitespace", () => {
  assert.equal(stripLocalSuffix("  Mac-mini.LOCAL. "), "Mac-mini");
});

test("stripLocalSuffix leaves non-mDNS hostnames untouched", () => {
  assert.equal(stripLocalSuffix("example.com"), "example.com");
  assert.equal(stripLocalSuffix("192.168.1.5"), "192.168.1.5");
  assert.equal(stripLocalSuffix("MacBook"), "MacBook");
  assert.equal(stripLocalSuffix(""), "");
});

// ---------------------------------------------------------------------------
// displayInstanceLabel / fallbackInstanceLabel —— 展示回退
// ---------------------------------------------------------------------------

test("fallbackInstanceLabel shows an ellipsis plus the last 8 fingerprint chars", () => {
  assert.equal(fallbackInstanceLabel("abcdefgh12345678"), "…12345678");
  // 短指纹不截断,原样接在省略号后。
  assert.equal(fallbackInstanceLabel("abc"), "…abc");
});

test("displayInstanceLabel prefers the alias and falls back to the fingerprint tail", () => {
  assert.equal(displayInstanceLabel("Studio Mac", "abcdefgh12345678"), "Studio Mac");
  assert.equal(displayInstanceLabel(undefined, "abcdefgh12345678"), "…12345678");
});

// ---------------------------------------------------------------------------
// defaultInstanceAlias —— 配对完成流程末尾的默认值优先级
// ---------------------------------------------------------------------------

test("defaultInstanceAlias prefers the mDNS service name over everything else", () => {
  assert.equal(
    defaultInstanceAlias({
      serviceName: "Leo's Mac Studio",
      hostName: "Mac-Studio.local.",
      qrHosts: ["192.168.1.5"],
      fingerprint: "abcdefgh12345678",
    }),
    "Leo's Mac Studio",
  );
});

test("defaultInstanceAlias falls back to the mDNS hostname with the .local suffix stripped", () => {
  assert.equal(
    defaultInstanceAlias({
      hostName: "MacBook-Pro.local.",
      qrHosts: ["192.168.1.5"],
      fingerprint: "abcdefgh12345678",
    }),
    "MacBook-Pro",
  );
});

test("defaultInstanceAlias uses the first QR host when no mDNS identity is known", () => {
  // 扫码那一刻 mDNS 通常尚未解析出新实例——QR hosts 是实际主要来源。
  assert.equal(
    defaultInstanceAlias({
      qrHosts: ["192.168.1.5", "fd00::1"],
      fingerprint: "abcdefgh12345678",
    }),
    "192.168.1.5",
  );
});

test("defaultInstanceAlias skips blank QR hosts", () => {
  assert.equal(
    defaultInstanceAlias({
      qrHosts: ["  ", "", "10.0.0.2"],
      fingerprint: "abcdefgh12345678",
    }),
    "10.0.0.2",
  );
});

test("defaultInstanceAlias falls back to the fingerprint tail when nothing is known", () => {
  assert.equal(defaultInstanceAlias({ fingerprint: "abcdefgh12345678" }), "…12345678");
});

test("defaultInstanceAlias ignores whitespace-only candidates at every level", () => {
  assert.equal(
    defaultInstanceAlias({
      serviceName: "   ",
      hostName: "  ",
      qrHosts: ["  "],
      fingerprint: "abcdefgh12345678",
    }),
    "…12345678",
  );
});
