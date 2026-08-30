import assert from "node:assert/strict";
import test from "node:test";

import { PinnedFetchError } from "pinned-fetch/src/PinnedFetch.types";

import { NetworkError } from "./i18n/errors";
import { withHostFallback } from "./host-fallback";

const CONNECTION_CODES = new Set(["revoke_tls", "revoke_timeout", "fingerprint_mismatch"] as const);

const classify = (error: PinnedFetchError) =>
  error.code === "timeout"
    ? new NetworkError("revoke_timeout")
    : new NetworkError("revoke_tls", error.message);

test("首个地址连接失败时回退到下一候选并成功", async () => {
  const tried: string[] = [];
  const result = await withHostFallback(
    "test",
    ["https://a:9808/x", "https://b:9808/x"],
    async (url) => {
      tried.push(url);
      if (url.startsWith("https://a")) throw new PinnedFetchError({ code: "timeout", message: "boom" });
      return "ok";
    },
    classify,
    new Set(),
  );

  assert.equal(result, "ok");
  assert.deepEqual(tried, ["https://a:9808/x", "https://b:9808/x"]);
});

test("指纹不匹配也算连接失败并回退（QR hosts 混入其它 daemon 的地址）", async () => {
  const result = await withHostFallback(
    "test",
    ["https://a:9808/x", "https://b:9808/x"],
    async (url) => {
      if (url.startsWith("https://a")) {
        throw new PinnedFetchError({ code: "fingerprint_mismatch", message: "wrong daemon" });
      }
      return 42;
    },
    classify,
    new Set(),
  );

  assert.equal(result, 42);
});

test("应用层 NetworkError 不回退，直接上抛（daemon 已给出业务响应）", async () => {
  const tried: string[] = [];
  await assert.rejects(
    withHostFallback(
      "test",
      ["https://a:9808/x", "https://b:9808/x"],
      async (url) => {
        tried.push(url);
        throw new NetworkError("unauthorized");
      },
      classify,
      new Set(),
    ),
    (err: unknown) => err instanceof NetworkError && err.code === "unauthorized",
  );
  assert.deepEqual(tried, ["https://a:9808/x"]);
});

test("映射为连接层错误码的 NetworkError 回退（authPinnedFetch 已转换的形态）", async () => {
  const tried: string[] = [];
  const result = await withHostFallback(
    "test",
    ["https://a:9808/x", "https://b:9808/x"],
    async (url) => {
      tried.push(url);
      if (url.startsWith("https://a")) throw new NetworkError("revoke_timeout");
      return "ok";
    },
    classify,
    new Set(CONNECTION_CODES),
  );

  assert.equal(result, "ok");
  assert.deepEqual(tried, ["https://a:9808/x", "https://b:9808/x"]);
});

test("全部候选连接失败时用 classify 映射最后一个错误抛出", async () => {
  await assert.rejects(
    withHostFallback(
      "test",
      ["https://a:9808/x", "https://b:9808/x"],
      async (url) => {
        throw new PinnedFetchError({
          code: url.startsWith("https://b") ? "tls_handshake_failed" : "timeout",
          message: "unreachable",
        });
      },
      classify,
      new Set(),
    ),
    (err: unknown) => err instanceof NetworkError && err.code === "revoke_tls",
  );
});

test("全部候选以已映射的连接层 NetworkError 失败时原样抛出", async () => {
  await assert.rejects(
    withHostFallback(
      "test",
      ["https://a:9808/x"],
      async () => {
        throw new NetworkError("revoke_timeout");
      },
      classify,
      new Set(CONNECTION_CODES),
    ),
    (err: unknown) => err instanceof NetworkError && err.code === "revoke_timeout",
  );
});

test("空候选列表直接抛 no_address", async () => {
  await assert.rejects(
    withHostFallback(
      "test",
      [],
      async () => "never",
      classify,
      new Set(),
    ),
    (err: unknown) => err instanceof NetworkError && err.code === "no_address",
  );
});
