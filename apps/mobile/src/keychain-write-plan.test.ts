import assert from "node:assert/strict";
import test from "node:test";

import type { DeviceCredentials, PairedInstancesModel } from "./paired-instances";
import { planKeychainWrites } from "./keychain-write-plan";

const instance = (
  fingerprint: string,
  overrides: Partial<DeviceCredentials> = {},
): DeviceCredentials => ({
  fingerprint,
  deviceId: `dev-${fingerprint}`,
  token: `token-${fingerprint}`,
  deviceName: "My iPhone",
  pairedAt: "2026-08-30T00:00:00.000Z",
  ...overrides,
});

const model = (
  instances: readonly DeviceCredentials[],
  activeFingerprint: string | null,
): PairedInstancesModel => ({
  activeFingerprint,
  instances: Object.fromEntries(instances.map((item) => [item.fingerprint, item])),
});

// ---------------------------------------------------------------------------
// 崩溃窗口自愈:写入顺序规则
// ---------------------------------------------------------------------------

test("planKeychainWrites 新增实例时索引先于实例键落盘", () => {
  // 配对写入在「索引已含新 fingerprint、实例键尚未落盘」处被打断时,
  // readModel 按「索引有、条目缺失」自愈跳过,下次 writeModel 从索引
  // 清除;反序(先键后索引)会留下永不清理的孤儿实例键(配对结果不可见)。
  const plan = planKeychainWrites(["fp-a"], model([instance("fp-a"), instance("fp-b")], "fp-b"));
  const indexAt = plan.findIndex((step) => step.kind === "write_index");
  const newKeyAt = plan.findIndex((step) => step.kind === "write_instance" && step.fingerprint === "fp-b");
  assert.ok(indexAt !== -1 && newKeyAt !== -1);
  assert.ok(indexAt < newKeyAt, "write_index 必须先于新实例键写入");
});

test("planKeychainWrites 移除实例时先删键、后写索引", () => {
  // 解绑写入在「实例键已删、索引仍引用」处被打断时,readModel 同样按
  // 「索引有、条目缺失」自愈跳过;反序(先索引后删键)会把实例键删到
  // 索引之外,成为孤儿键。
  const plan = planKeychainWrites(["fp-a", "fp-b"], model([instance("fp-a")], "fp-a"));
  const deleteAt = plan.findIndex((step) => step.kind === "delete_instance" && step.fingerprint === "fp-b");
  const indexAt = plan.findIndex(
    (step) => step.kind === "write_index" && !step.fingerprints.includes("fp-b"),
  );
  assert.ok(deleteAt !== -1 && indexAt !== -1);
  assert.ok(deleteAt < indexAt, "delete_instance 必须先于新索引写入");
});

test("planKeychainWrites 活动实例指针永远最后同步", () => {
  // stale 指针(指向已不存在的实例)由 resolveActiveInstance 的最近配对
  // 回退自愈;先写指针再写实例反而可能让指针短暂指向未落盘的实例。
  const cases: Array<[readonly string[], PairedInstancesModel]> = [
    [[], model([instance("fp-a")], "fp-a")],
    [["fp-a"], model([instance("fp-a"), instance("fp-b")], "fp-b")],
    [["fp-a", "fp-b"], model([], null)],
  ];
  for (const [previous, next] of cases) {
    const plan = planKeychainWrites(previous, next);
    const last = plan[plan.length - 1];
    assert.ok(last);
    assert.equal(last.kind, "set_active");
  }
});

// ---------------------------------------------------------------------------
// 步骤序列形状(确定性)
// ---------------------------------------------------------------------------

test("planKeychainWrites 新增配对:无删除,索引与实例键按模型键序", () => {
  const added = model([instance("fp-a"), instance("fp-b")], "fp-b");
  assert.deepEqual(planKeychainWrites([], added), [
    { kind: "write_index", fingerprints: ["fp-a", "fp-b"] },
    { kind: "write_instance", fingerprint: "fp-a" },
    { kind: "write_instance", fingerprint: "fp-b" },
    { kind: "set_active", fingerprint: "fp-b" },
  ]);
});

test("planKeychainWrites 清空模型:按旧索引序删除全部实例键", () => {
  assert.deepEqual(planKeychainWrites(["fp-b", "fp-a"], model([], null)), [
    { kind: "delete_instance", fingerprint: "fp-b" },
    { kind: "delete_instance", fingerprint: "fp-a" },
    { kind: "write_index", fingerprints: [] },
    { kind: "set_active", fingerprint: null },
  ]);
});

test("planKeychainWrites 模型与索引一致时仍重放全量写入(幂等)", () => {
  const current = model([instance("fp-a")], "fp-a");
  assert.deepEqual(planKeychainWrites(["fp-a"], current), [
    { kind: "write_index", fingerprints: ["fp-a"] },
    { kind: "write_instance", fingerprint: "fp-a" },
    { kind: "set_active", fingerprint: "fp-a" },
  ]);
});
