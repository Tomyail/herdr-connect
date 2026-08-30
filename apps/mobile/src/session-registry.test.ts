import assert from "node:assert/strict";
import test from "node:test";

import type { DeviceCredentials } from "./paired-instances";
import { shouldRestartDiscovery } from "./discovery-lifecycle";
import {
  planForegroundTransition,
  planSessionRetry,
  planSessionSet,
} from "./session-registry";

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

// ---------------------------------------------------------------------------
// planSessionSet —— 会话集合管理(实例 ↔ 会话 reconcile)
// ---------------------------------------------------------------------------

test("planSessionSet 空模型对空会话集合是无操作", () => {
  const plan = planSessionSet([], new Map());
  assert.deepEqual(plan, { stop: [], start: [] });
});

test("planSessionSet 为每个已配对实例规划一个会话", () => {
  const a = instance("fp-a");
  const b = instance("fp-b");
  const plan = planSessionSet([a, b], new Map());
  assert.deepEqual(plan.stop, []);
  assert.deepEqual(plan.start, [a, b]);
});

test("planSessionSet 保留未变化的会话,只为新增实例建会话", () => {
  const a = instance("fp-a");
  const b = instance("fp-b");
  const existing = new Map([[a.fingerprint, a]]);
  const plan = planSessionSet([a, b], existing);
  assert.deepEqual(plan.stop, []);
  assert.deepEqual(plan.start, [b]);
});

test("planSessionSet 移除已解绑实例的会话", () => {
  const a = instance("fp-a");
  const b = instance("fp-b");
  const existing = new Map([
    [a.fingerprint, a],
    [b.fingerprint, b],
  ]);
  const plan = planSessionSet([a], existing);
  assert.deepEqual(plan.stop, ["fp-b"]);
  assert.deepEqual(plan.start, []);
});

test("planSessionSet 清空模型时拆除全部会话", () => {
  const a = instance("fp-a");
  const b = instance("fp-b");
  const existing = new Map([
    [a.fingerprint, a],
    [b.fingerprint, b],
  ]);
  const plan = planSessionSet([], existing);
  assert.deepEqual(plan.stop, ["fp-a", "fp-b"]);
  assert.deepEqual(plan.start, []);
});

test("planSessionSet 同 fingerprint 重新配对(凭据变化)替换会话", () => {
  const old = instance("fp-a", { token: "old-token", pairedAt: "2026-01-01T00:00:00.000Z" });
  const rePaired = instance("fp-a", { token: "new-token", pairedAt: "2026-08-30T12:00:00.000Z" });
  const existing = new Map([[old.fingerprint, old]]);
  const plan = planSessionSet([rePaired], existing);
  assert.deepEqual(plan.stop, ["fp-a"]);
  assert.deepEqual(plan.start, [rePaired]);
});

test("planSessionSet 展示字段变化(deviceName)也触发会话替换", () => {
  const old = instance("fp-a", { deviceName: "Old name" });
  const renamed = instance("fp-a", { deviceName: "New name" });
  const existing = new Map([[old.fingerprint, old]]);
  const plan = planSessionSet([renamed], existing);
  assert.deepEqual(plan.stop, ["fp-a"]);
  assert.deepEqual(plan.start, [renamed]);
});

test("planSessionSet 凭据完全一致时是幂等无操作", () => {
  const a = instance("fp-a");
  const existing = new Map([[a.fingerprint, a]]);
  const plan = planSessionSet([a], existing);
  assert.deepEqual(plan, { stop: [], start: [] });
});

// ---------------------------------------------------------------------------
// planForegroundTransition —— 前后台对 N 会话的启停映射
// ---------------------------------------------------------------------------

test("planForegroundTransition 回到 active 时全部会话恢复并重启发现", () => {
  assert.deepEqual(planForegroundTransition("background", "active"), {
    sessionAction: "begin",
    restartDiscovery: true,
  });
  assert.deepEqual(planForegroundTransition("inactive", "active"), {
    sessionAction: "begin",
    restartDiscovery: true,
  });
});

test("planForegroundTransition 退到 background 时全部会话暂停、不动发现", () => {
  assert.deepEqual(planForegroundTransition("active", "background"), {
    sessionAction: "pause",
    restartDiscovery: false,
  });
  assert.deepEqual(planForegroundTransition("inactive", "background"), {
    sessionAction: "pause",
    restartDiscovery: false,
  });
});

test("planForegroundTransition 短暂 inactive 维持现状不断流", () => {
  // iOS 下拉通知中心/系统弹窗等失焦是 active→inactive,尚未真正退后台:
  // 会话保持轮询/SSE/重连不断流,避免连接抖动;真正退到 background 才全停。
  assert.deepEqual(planForegroundTransition("active", "inactive"), {
    sessionAction: "hold",
    restartDiscovery: false,
  });
});

test("planForegroundTransition 后台内的状态转换维持现状", () => {
  // 会话已在 background 时 pause,background→inactive 无需额外动作。
  assert.deepEqual(planForegroundTransition("background", "inactive"), {
    sessionAction: "hold",
    restartDiscovery: false,
  });
});

test("planForegroundTransition 的重启发现判定与 shouldRestartDiscovery 一致", () => {
  // 交叉验证:沿用既有 discovery-lifecycle 的语义,不引入第二套真相。
  const transitions: Array<[string, string]> = [
    ["active", "background"],
    ["background", "active"],
    ["inactive", "active"],
    ["active", "active"],
    ["background", "inactive"],
  ];
  for (const [previous, next] of transitions) {
    assert.equal(
      planForegroundTransition(previous, next).restartDiscovery,
      shouldRestartDiscovery(previous, next),
      `${previous} → ${next}`,
    );
  }
});

// ---------------------------------------------------------------------------
// planSessionRetry —— 退避重试映射
// ---------------------------------------------------------------------------

test("planSessionRetry 只重试 not_found 与 failed 相位的会话", () => {
  const phases = new Map([
    ["fp-connected", "connected"],
    ["fp-not-found", "not_found"],
    ["fp-failed", "failed"],
    ["fp-discovering", "discovering"],
  ]);
  assert.deepEqual(planSessionRetry(phases), {
    restartProbes: ["fp-not-found", "fp-failed"],
    restartDiscovery: true,
    probing: true,
  });
});

test("planSessionRetry 标记 discovering 为推进中(保留退避计数,不重试)", () => {
  const phases = new Map([
    ["fp-a", "connected"],
    ["fp-b", "discovering"],
  ]);
  assert.deepEqual(planSessionRetry(phases), {
    restartProbes: [],
    restartDiscovery: false,
    probing: true,
  });
});

test("planSessionRetry 终态相位(需用户动作)不触发重试", () => {
  const phases = new Map([
    ["fp-a", "not_paired"],
    ["fp-b", "revoked"],
    ["fp-c", "daemon_outdated"],
    ["fp-d", "app_outdated"],
  ]);
  assert.deepEqual(planSessionRetry(phases), {
    restartProbes: [],
    restartDiscovery: false,
    probing: false,
  });
});

test("planSessionRetry 全部健康时无动作", () => {
  const phases = new Map([
    ["fp-a", "connected"],
    ["fp-b", "connected"],
  ]);
  assert.deepEqual(planSessionRetry(phases), {
    restartProbes: [],
    restartDiscovery: false,
    probing: false,
  });
});

test("planSessionRetry 空会话集合无动作", () => {
  assert.deepEqual(planSessionRetry(new Map()), {
    restartProbes: [],
    restartDiscovery: false,
    probing: false,
  });
});
