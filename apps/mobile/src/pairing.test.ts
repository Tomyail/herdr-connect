import assert from "node:assert/strict";
import test from "node:test";

import { NetworkError } from "./i18n/errors";
import { parsePairingQRPayload, pairingUrls } from "./pairing";

const validQRPayload = JSON.stringify({
  v: 1,
  fp: "abc123def456",
  hosts: ["192.168.1.100", "fe80::1"],
  port: 9808,
  secret: "s3cret-k3y",
});

test("parsePairingQRPayload parses a valid payload correctly", () => {
  const result = parsePairingQRPayload(validQRPayload);
  assert.equal(result.v, 1);
  assert.equal(result.fp, "abc123def456");
  assert.deepEqual(result.hosts, ["192.168.1.100", "fe80::1"]);
  assert.equal(result.port, 9808);
  assert.equal(result.secret, "s3cret-k3y");
});

test("parsePairingQRPayload throws pairing_qr_invalid for non-JSON input", () => {
  assert.throws(
    () => parsePairingQRPayload("not json"),
    (err: unknown) => err instanceof NetworkError && err.code === "pairing_qr_invalid",
  );
});

test("parsePairingQRPayload throws pairing_qr_invalid for null", () => {
  assert.throws(
    () => parsePairingQRPayload("null"),
    (err: unknown) => err instanceof NetworkError && err.code === "pairing_qr_invalid",
  );
});

test("parsePairingQRPayload throws pairing_qr_invalid for an array", () => {
  assert.throws(
    () => parsePairingQRPayload("[]"),
    (err: unknown) => err instanceof NetworkError && err.code === "pairing_qr_invalid",
  );
});

test("parsePairingQRPayload throws pairing_qr_invalid when v is missing", () => {
  const payload = { fp: "abc", hosts: ["192.168.1.1"], port: 9808, secret: "s" };
  assert.throws(
    () => parsePairingQRPayload(JSON.stringify(payload)),
    (err: unknown) => err instanceof NetworkError && err.code === "pairing_qr_invalid",
  );
});

test("parsePairingQRPayload throws pairing_qr_invalid when v is a string", () => {
  const payload = { v: "1", fp: "abc", hosts: ["192.168.1.1"], port: 9808, secret: "s" };
  assert.throws(
    () => parsePairingQRPayload(JSON.stringify(payload)),
    (err: unknown) => err instanceof NetworkError && err.code === "pairing_qr_invalid",
  );
});

test("parsePairingQRPayload throws pairing_qr_invalid when fp is empty string", () => {
  const payload = { v: 1, fp: "", hosts: ["192.168.1.1"], port: 9808, secret: "s" };
  assert.throws(
    () => parsePairingQRPayload(JSON.stringify(payload)),
    (err: unknown) => err instanceof NetworkError && err.code === "pairing_qr_invalid",
  );
});

test("parsePairingQRPayload throws pairing_qr_invalid when fp is missing", () => {
  const payload = { v: 1, hosts: ["192.168.1.1"], port: 9808, secret: "s" };
  assert.throws(
    () => parsePairingQRPayload(JSON.stringify(payload)),
    (err: unknown) => err instanceof NetworkError && err.code === "pairing_qr_invalid",
  );
});

test("parsePairingQRPayload throws pairing_qr_invalid when fp is a number", () => {
  const payload = { v: 1, fp: 123, hosts: ["192.168.1.1"], port: 9808, secret: "s" };
  assert.throws(
    () => parsePairingQRPayload(JSON.stringify(payload)),
    (err: unknown) => err instanceof NetworkError && err.code === "pairing_qr_invalid",
  );
});

test("parsePairingQRPayload throws pairing_qr_invalid when secret is empty", () => {
  const payload = { v: 1, fp: "abc", hosts: ["192.168.1.1"], port: 9808, secret: "" };
  assert.throws(
    () => parsePairingQRPayload(JSON.stringify(payload)),
    (err: unknown) => err instanceof NetworkError && err.code === "pairing_qr_invalid",
  );
});

test("parsePairingQRPayload throws pairing_qr_invalid when secret is missing", () => {
  const payload = { v: 1, fp: "abc", hosts: ["192.168.1.1"], port: 9808 };
  assert.throws(
    () => parsePairingQRPayload(JSON.stringify(payload)),
    (err: unknown) => err instanceof NetworkError && err.code === "pairing_qr_invalid",
  );
});

test("parsePairingQRPayload throws pairing_qr_invalid when hosts is empty array", () => {
  const payload = { v: 1, fp: "abc", hosts: [], port: 9808, secret: "s" };
  assert.throws(
    () => parsePairingQRPayload(JSON.stringify(payload)),
    (err: unknown) => err instanceof NetworkError && err.code === "pairing_qr_invalid",
  );
});

test("parsePairingQRPayload throws pairing_qr_invalid when hosts is missing", () => {
  const payload = { v: 1, fp: "abc", port: 9808, secret: "s" };
  assert.throws(
    () => parsePairingQRPayload(JSON.stringify(payload)),
    (err: unknown) => err instanceof NetworkError && err.code === "pairing_qr_invalid",
  );
});

test("parsePairingQRPayload throws pairing_qr_invalid when hosts contains non-strings", () => {
  const payload = { v: 1, fp: "abc", hosts: ["192.168.1.1", 123], port: 9808, secret: "s" };
  assert.throws(
    () => parsePairingQRPayload(JSON.stringify(payload)),
    (err: unknown) => err instanceof NetworkError && err.code === "pairing_qr_invalid",
  );
});

test("parsePairingQRPayload throws pairing_qr_invalid when port is missing", () => {
  const payload = { v: 1, fp: "abc", hosts: ["192.168.1.1"], secret: "s" };
  assert.throws(
    () => parsePairingQRPayload(JSON.stringify(payload)),
    (err: unknown) => err instanceof NetworkError && err.code === "pairing_qr_invalid",
  );
});

test("parsePairingQRPayload throws pairing_qr_invalid when port is not an integer", () => {
  const payload = { v: 1, fp: "abc", hosts: ["192.168.1.1"], port: 9808.5, secret: "s" };
  assert.throws(
    () => parsePairingQRPayload(JSON.stringify(payload)),
    (err: unknown) => err instanceof NetworkError && err.code === "pairing_qr_invalid",
  );
});

test("parsePairingQRPayload throws pairing_qr_invalid when port is non-positive", () => {
  const payload = { v: 1, fp: "abc", hosts: ["192.168.1.1"], port: 0, secret: "s" };
  assert.throws(
    () => parsePairingQRPayload(JSON.stringify(payload)),
    (err: unknown) => err instanceof NetworkError && err.code === "pairing_qr_invalid",
  );
});

test("pairingUrls 保持 daemon 给出的地址顺序（IPv4 升序在前）", () => {
  const payload = parsePairingQRPayload(validQRPayload);
  assert.deepEqual(pairingUrls(payload), [
    "https://192.168.1.100:9808/v1/pair",
    "https://[fe80::1]:9808/v1/pair",
  ]);
});

test("pairingUrls brackets IPv6 addresses", () => {
  const payload = parsePairingQRPayload(
    JSON.stringify({
      v: 1,
      fp: "abc",
      hosts: ["fe80::1"],
      port: 9808,
      secret: "s",
    }),
  );
  assert.deepEqual(pairingUrls(payload), ["https://[fe80::1]:9808/v1/pair"]);
});

test("pairingUrls returns an empty list when hosts is empty (caller falls back to no_address)", () => {
  // parsePairingQRPayload 已拒绝空 hosts，这里验证防御路径。
  assert.deepEqual(pairingUrls({ v: 1, fp: "a", hosts: [], port: 9808, secret: "s" }), []);
});

test("pairingUrl uses the port from the payload, not a hardcoded value", () => {
  const payload = parsePairingQRPayload(
    JSON.stringify({
      v: 1,
      fp: "abc",
      hosts: ["10.0.0.1"],
      port: 443,
      secret: "s",
    }),
  );
  const url = pairingUrls(payload);
  assert.deepEqual(url, ["https://10.0.0.1:443/v1/pair"]);
});
