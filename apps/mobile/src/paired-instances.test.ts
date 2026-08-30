import assert from "node:assert/strict";
import test from "node:test";

import {
  listInstances,
  migrateLegacyCredentials,
  mostRecentInstance,
  parseInstanceRecord,
  parseInstanceRecordJson,
  removeInstance,
  resolveActiveInstance,
  setActiveInstance,
  upsertInstance,
  type DeviceCredentials,
  type PairedInstancesModel,
} from "./paired-instances";

const instance = (
  fingerprint: string,
  overrides: Partial<DeviceCredentials> = {},
): DeviceCredentials => ({
  fingerprint,
  deviceId: `dev_${fingerprint}`,
  token: `tok_${fingerprint}`,
  deviceName: "My iPhone",
  pairedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const withInstances = (
  instances: Record<string, DeviceCredentials>,
  activeFingerprint: string | null = null,
): PairedInstancesModel => ({ activeFingerprint, instances });

// ---------------------------------------------------------------------------
// parseInstanceRecord —— 单条记录形状校验
// ---------------------------------------------------------------------------

test("parseInstanceRecord parses a valid record", () => {
  const record = instance("fp-a");
  assert.deepEqual(parseInstanceRecord(record), record);
});

test("parseInstanceRecord accepts extra fields but requires the five core strings", () => {
  const parsed = parseInstanceRecord({ ...instance("fp-a"), extra: "ignored" });
  assert.ok(parsed);
  assert.equal(parsed.fingerprint, "fp-a");
  assert.equal("extra" in parsed, false);
});

test("parseInstanceRecord rejects non-object shapes", () => {
  assert.equal(parseInstanceRecord(null), null);
  assert.equal(parseInstanceRecord(undefined), null);
  assert.equal(parseInstanceRecord("fp-a"), null);
  assert.equal(parseInstanceRecord(42), null);
  assert.equal(parseInstanceRecord([]), null);
});

test("parseInstanceRecord rejects missing or mistyped fields", () => {
  assert.equal(parseInstanceRecord({}), null);
  const base = instance("fp-a");
  for (const field of ["fingerprint", "deviceId", "token", "deviceName", "pairedAt"]) {
    assert.equal(parseInstanceRecord({ ...base, [field]: 1 }), null, `${field} mistyped`);
    const without: Record<string, unknown> = { ...base };
    delete without[field];
    assert.equal(parseInstanceRecord(without), null, `${field} missing`);
  }
});

test("parseInstanceRecord rejects empty fingerprint and empty token", () => {
  assert.equal(parseInstanceRecord(instance("")), null);
  assert.equal(parseInstanceRecord(instance("fp-a", { token: "" })), null);
});

test("parseInstanceRecordJson round-trips valid JSON and rejects invalid", () => {
  assert.deepEqual(parseInstanceRecordJson(JSON.stringify(instance("fp-a"))), instance("fp-a"));
  assert.equal(parseInstanceRecordJson("not json"), null);
  assert.equal(parseInstanceRecordJson(JSON.stringify({ fingerprint: "fp-a" })), null);
});

// ---------------------------------------------------------------------------
// upsertInstance —— fingerprint 键控规则
// ---------------------------------------------------------------------------

test("upsertInstance keeps different fingerprints side by side (no overwrite)", () => {
  let model = withInstances({});
  model = upsertInstance(model, instance("fp-a", { pairedAt: "2026-01-01T00:00:00.000Z" }));
  model = upsertInstance(model, instance("fp-b", { pairedAt: "2026-02-01T00:00:00.000Z" }));
  assert.deepEqual(Object.keys(model.instances).sort(), ["fp-a", "fp-b"]);
});

test("upsertInstance replaces an existing fingerprint instead of duplicating it", () => {
  let model = upsertInstance(withInstances({}), instance("fp-a", { token: "old" }));
  model = upsertInstance(model, instance("fp-a", { token: "new", pairedAt: "2026-03-01T00:00:00.000Z" }));
  assert.equal(Object.keys(model.instances).length, 1);
  assert.equal(model.instances["fp-a"]?.token, "new");
});

test("upsertInstance activates the stored instance by default (pair → connect it)", () => {
  const model = upsertInstance(withInstances({}), instance("fp-a"));
  assert.equal(model.activeFingerprint, "fp-a");
});

test("upsertInstance re-pairing an existing fingerprint keeps it active with fresh credentials", () => {
  let model = upsertInstance(withInstances({}), instance("fp-a"));
  model = upsertInstance(model, instance("fp-b"));
  assert.equal(model.activeFingerprint, "fp-b");
  model = upsertInstance(model, instance("fp-a", { token: "refreshed" }));
  assert.equal(model.activeFingerprint, "fp-a");
  assert.equal(model.instances["fp-a"]?.token, "refreshed");
});

test("upsertInstance with activate:false preserves the current active pointer", () => {
  let model = upsertInstance(withInstances({}), instance("fp-a"));
  model = upsertInstance(model, instance("fp-b"), { activate: false });
  assert.equal(model.activeFingerprint, "fp-a");
});

// ---------------------------------------------------------------------------
// removeInstance —— 解绑与活动指针回退
// ---------------------------------------------------------------------------

test("removeInstance removes the entry and is a no-op for unknown fingerprints", () => {
  const model = withInstances({ "fp-a": instance("fp-a") }, "fp-a");
  const removed = removeInstance(model, "fp-zz");
  assert.equal(removed, model);
  const after = removeInstance(model, "fp-a");
  assert.deepEqual(after.instances, {});
  assert.equal(after.activeFingerprint, null);
});

test("removeInstance of the active instance falls back to the most recently paired", () => {
  const model = withInstances(
    {
      "fp-a": instance("fp-a", { pairedAt: "2026-01-01T00:00:00.000Z" }),
      "fp-b": instance("fp-b", { pairedAt: "2026-02-01T00:00:00.000Z" }),
      "fp-c": instance("fp-c", { pairedAt: "2026-03-01T00:00:00.000Z" }),
    },
    "fp-c",
  );
  const after = removeInstance(model, "fp-c");
  assert.equal(after.activeFingerprint, "fp-b");
  assert.equal("fp-c" in after.instances, false);
});

test("removeInstance of a non-active instance keeps the active pointer", () => {
  const model = withInstances(
    {
      "fp-a": instance("fp-a", { pairedAt: "2026-01-01T00:00:00.000Z" }),
      "fp-b": instance("fp-b", { pairedAt: "2026-02-01T00:00:00.000Z" }),
    },
    "fp-a",
  );
  const after = removeInstance(model, "fp-b");
  assert.equal(after.activeFingerprint, "fp-a");
});

// ---------------------------------------------------------------------------
// resolveActiveInstance —— 活动实例解析（含冷启动恢复与异常回退）
// ---------------------------------------------------------------------------

test("resolveActiveInstance returns the explicitly active instance", () => {
  const model = withInstances(
    {
      "fp-a": instance("fp-a", { pairedAt: "2026-01-01T00:00:00.000Z" }),
      "fp-b": instance("fp-b", { pairedAt: "2026-02-01T00:00:00.000Z" }),
    },
    "fp-a",
  );
  assert.equal(resolveActiveInstance(model)?.fingerprint, "fp-a");
});

test("resolveActiveInstance falls back to the most recently paired when active is null", () => {
  const model = withInstances({
    "fp-a": instance("fp-a", { pairedAt: "2026-01-01T00:00:00.000Z" }),
    "fp-b": instance("fp-b", { pairedAt: "2026-02-01T00:00:00.000Z" }),
  });
  assert.equal(resolveActiveInstance(model)?.fingerprint, "fp-b");
});

test("resolveActiveInstance falls back when the active pointer is stale (points at a removed instance)", () => {
  const model = withInstances(
    {
      "fp-a": instance("fp-a", { pairedAt: "2026-01-01T00:00:00.000Z" }),
      "fp-b": instance("fp-b", { pairedAt: "2026-02-01T00:00:00.000Z" }),
    },
    "fp-gone",
  );
  assert.equal(resolveActiveInstance(model)?.fingerprint, "fp-b");
});

test("resolveActiveInstance returns null for an empty model", () => {
  assert.equal(resolveActiveInstance(withInstances({})), null);
  assert.equal(resolveActiveInstance(withInstances({}, "fp-gone")), null);
});

// ---------------------------------------------------------------------------
// 排序确定性 —— mostRecentInstance / listInstances
// ---------------------------------------------------------------------------

test("mostRecentInstance orders by pairedAt and breaks ties by fingerprint", () => {
  const model = withInstances({
    "fp-b": instance("fp-b", { pairedAt: "2026-02-01T00:00:00.000Z" }),
    "fp-a": instance("fp-a", { pairedAt: "2026-03-01T00:00:00.000Z" }),
    "fp-c": instance("fp-c", { pairedAt: "2026-03-01T00:00:00.000Z" }),
  });
  assert.equal(mostRecentInstance(model)?.fingerprint, "fp-a");
});

test("mostRecentInstance treats invalid pairedAt as the oldest", () => {
  const model = withInstances({
    "fp-a": instance("fp-a", { pairedAt: "not-a-date" }),
    "fp-b": instance("fp-b", { pairedAt: "2020-01-01T00:00:00.000Z" }),
  });
  assert.equal(mostRecentInstance(model)?.fingerprint, "fp-b");
});

test("listInstances returns most-recently-paired first with deterministic ties", () => {
  const model = withInstances({
    "fp-c": instance("fp-c", { pairedAt: "2026-01-01T00:00:00.000Z" }),
    "fp-a": instance("fp-a", { pairedAt: "2026-03-01T00:00:00.000Z" }),
    "fp-b": instance("fp-b", { pairedAt: "2026-03-01T00:00:00.000Z" }),
  });
  assert.deepEqual(
    listInstances(model).map((i) => i.fingerprint),
    ["fp-a", "fp-b", "fp-c"],
  );
});

// ---------------------------------------------------------------------------
// setActiveInstance —— 切换守卫
// ---------------------------------------------------------------------------

test("setActiveInstance switches to a known instance and is idempotent for the current one", () => {
  const model = withInstances(
    {
      "fp-a": instance("fp-a", { pairedAt: "2026-01-01T00:00:00.000Z" }),
      "fp-b": instance("fp-b", { pairedAt: "2026-02-01T00:00:00.000Z" }),
    },
    "fp-a",
  );
  const switched = setActiveInstance(model, "fp-b");
  assert.equal(switched.activeFingerprint, "fp-b");
  assert.equal(setActiveInstance(switched, "fp-b"), switched);
  assert.equal(setActiveInstance(model, "fp-gone"), model);
});

// ---------------------------------------------------------------------------
// migrateLegacyCredentials —— 旧版单凭据迁移合并规则
// ---------------------------------------------------------------------------

test("migrateLegacyCredentials moves a legacy credential into an empty model and activates it", () => {
  const legacy = instance("fp-legacy", { pairedAt: "2025-12-01T00:00:00.000Z" });
  const model = migrateLegacyCredentials(withInstances({}), legacy);
  assert.equal(model.instances["fp-legacy"], legacy);
  assert.equal(model.activeFingerprint, "fp-legacy");
});

test("migrateLegacyCredentials inserts alongside existing instances without stealing the active pointer", () => {
  const existing = withInstances(
    { "fp-new": instance("fp-new", { pairedAt: "2026-06-01T00:00:00.000Z" }) },
    "fp-new",
  );
  const legacy = instance("fp-legacy", { pairedAt: "2025-12-01T00:00:00.000Z" });
  const model = migrateLegacyCredentials(existing, legacy);
  assert.deepEqual(Object.keys(model.instances).sort(), ["fp-legacy", "fp-new"]);
  assert.equal(model.activeFingerprint, "fp-new");
});

test("migrateLegacyCredentials skips a fingerprint that already exists (new data wins)", () => {
  const existing = withInstances(
    { "fp-a": instance("fp-a", { token: "fresh", pairedAt: "2026-06-01T00:00:00.000Z" }) },
    "fp-a",
  );
  const legacy = instance("fp-a", { token: "stale", pairedAt: "2025-12-01T00:00:00.000Z" });
  const model = migrateLegacyCredentials(existing, legacy);
  assert.equal(model.instances["fp-a"]?.token, "fresh");
  assert.equal(model, existing);
});

test("migrateLegacyCredentials is idempotent — applying it twice equals applying it once", () => {
  const legacy = instance("fp-legacy");
  const once = migrateLegacyCredentials(withInstances({}), legacy);
  const twice = migrateLegacyCredentials(once, legacy);
  assert.deepEqual(twice, once);
});

test("migrateLegacyCredentials into a model without an active pointer activates the legacy entry", () => {
  const existing = withInstances({
    "fp-new": instance("fp-new", { pairedAt: "2026-06-01T00:00:00.000Z" }),
  });
  const legacy = instance("fp-legacy", { pairedAt: "2025-12-01T00:00:00.000Z" });
  const model = migrateLegacyCredentials(existing, legacy);
  assert.equal(model.activeFingerprint, "fp-legacy");
});
