import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_INSTANCE_UI_SNAPSHOT,
  initialInstanceUiState,
  instanceUiReducer,
  resolveInstanceUiState,
  type InstanceUiState,
} from "./instance-ui-state";
import type { AgentStatusGroup } from "./agent-filter";

const selectAgent = (state: InstanceUiState, selectedAgentId: string | undefined): InstanceUiState =>
  instanceUiReducer(state, { type: "selectedAgent", selectedAgentId });

const selectDestination = (state: InstanceUiState, destination: "Agents" | "Settings"): InstanceUiState =>
  instanceUiReducer(state, { type: "destination", destination });

const setStatusFilter = (
  state: InstanceUiState,
  statusGroups: readonly AgentStatusGroup[],
): InstanceUiState =>
  instanceUiReducer(state, { type: "statusFilter", statusFilter: { statusGroups } });

const focusSwitch = (
  state: InstanceUiState,
  previousFingerprint: string | null,
  nextFingerprint: string | null,
): InstanceUiState =>
  instanceUiReducer(state, { type: "focusSwitch", previousFingerprint, nextFingerprint });

// ---------------------------------------------------------------------------
// selection —— 当前显示状态更新
// ---------------------------------------------------------------------------

test("selection 动作更新当前显示的页面与选中 Agent,不写记忆槽", () => {
  let state = initialInstanceUiState;
  state = selectDestination(state, "Settings");
  state = selectAgent(state, "agent-1");
  assert.deepEqual(state, {
    map: {},
    destination: "Settings",
    selectedAgentId: "agent-1",
    statusFilter: { statusGroups: [] },
  });
});

test("清空选中 Agent(back 到列表)后切走,记忆的也是列表态", () => {
  let state = initialInstanceUiState;
  state = selectAgent(state, "agent-1");
  state = selectAgent(state, undefined);
  const switched = focusSwitch(state, "fp-a", "fp-b");
  assert.deepEqual(switched.map["fp-a"], {
    destination: "Agents",
    selectedAgentId: undefined,
    statusFilter: { statusGroups: [] },
  });
});

// ---------------------------------------------------------------------------
// focusSwitch —— 焦点切换的记忆/恢复决策
// ---------------------------------------------------------------------------

test("切换实例时记忆旧焦点、恢复新焦点记忆", () => {
  // 实例 A:Settings 页。
  let state = selectDestination(initialInstanceUiState, "Settings");
  // 切到 B(无记忆 → 默认 Agents)。
  state = focusSwitch(state, "fp-a", "fp-b");
  assert.equal(state.destination, "Agents");
  assert.equal(state.selectedAgentId, undefined);
  assert.deepEqual(state.map["fp-a"], {
    destination: "Settings",
    selectedAgentId: undefined,
    statusFilter: { statusGroups: [] },
  });
  // 在 B 展开 agent-2。
  state = selectAgent(state, "agent-2");
  // 切回 A:恢复 Settings,B 被记忆。
  state = focusSwitch(state, "fp-b", "fp-a");
  assert.equal(state.destination, "Settings");
  assert.equal(state.selectedAgentId, undefined);
  assert.deepEqual(state.map["fp-b"], {
    destination: "Agents",
    selectedAgentId: "agent-2",
    statusFilter: { statusGroups: [] },
  });
});

test("demo 场景:A 展开 Agent 详情 → 切 B → 切回 A,仍在详情页", () => {
  let state = initialInstanceUiState;
  state = selectAgent(state, "agent-a1");
  state = focusSwitch(state, "fp-a", "fp-b");
  // B 显示默认列表;A 的详情被记忆。
  assert.equal(state.selectedAgentId, undefined);
  assert.equal(state.map["fp-a"]?.selectedAgentId, "agent-a1");
  const restored = focusSwitch(state, "fp-b", "fp-a");
  assert.equal(restored.selectedAgentId, "agent-a1");
  assert.equal(restored.destination, "Agents");
});

test("新实例首次成为焦点时落到默认页(无记忆)", () => {
  const state = focusSwitch(initialInstanceUiState, "fp-a", "fp-new");
  assert.deepEqual(
    { destination: state.destination, selectedAgentId: state.selectedAgentId, statusFilter: state.statusFilter },
    DEFAULT_INSTANCE_UI_SNAPSHOT,
  );
  assert.equal(state.map["fp-new"], undefined);
});

test("冷启动(无旧焦点)只应用恢复,不记忆到 null 槽", () => {
  // 模拟:启动时 map 已含各实例记忆(热重载场景),首次解析焦点。
  let state = initialInstanceUiState;
  state = {
    ...state,
    map: { "fp-a": { destination: "Settings", selectedAgentId: "agent-9", statusFilter: { statusGroups: [] } } },
  };
  const switched = focusSwitch(state, null, "fp-a");
  assert.equal(switched.destination, "Settings");
  assert.equal(switched.selectedAgentId, "agent-9");
  assert.equal("null" in switched.map, false);
});

test("全部解绑(next 为 null)回到默认页", () => {
  let state = selectAgent(initialInstanceUiState, "agent-1");
  state = focusSwitch(state, "fp-a", null);
  assert.deepEqual(
    { destination: state.destination, selectedAgentId: state.selectedAgentId, statusFilter: state.statusFilter },
    DEFAULT_INSTANCE_UI_SNAPSHOT,
  );
  // 旧实例记忆保留:再次配对回同一实例仍能恢复。
  assert.deepEqual(state.map["fp-a"], {
    destination: "Agents",
    selectedAgentId: "agent-1",
    statusFilter: { statusGroups: [] },
  });
});

test("重复对同一实例切换是幂等的(记忆当前后恢复当前)", () => {
  let state = selectAgent(initialInstanceUiState, "agent-1");
  state = focusSwitch(state, "fp-a", "fp-a");
  assert.equal(state.selectedAgentId, "agent-1");
  assert.equal(state.map["fp-a"]?.selectedAgentId, "agent-1");
});

// ---------------------------------------------------------------------------
// prune —— 实例集合收缩时清理记忆
// ---------------------------------------------------------------------------

test("prune 清理已解绑实例的记忆槽,保留存活实例", () => {
  let state = initialInstanceUiState;
  state = { ...state, map: {
    "fp-a": { destination: "Agents", selectedAgentId: "agent-1", statusFilter: { statusGroups: [] } },
    "fp-b": { destination: "Settings", selectedAgentId: undefined, statusFilter: { statusGroups: [] } },
    "fp-c": { destination: "Agents", selectedAgentId: "agent-3", statusFilter: { statusGroups: [] } },
  } };
  state = instanceUiReducer(state, { type: "prune", liveFingerprints: ["fp-a", "fp-c"] });
  assert.deepEqual(Object.keys(state.map), ["fp-a", "fp-c"]);
});

test("prune 无可清理时返回原状态引用(reducer 调用方可跳过渲染)", () => {
  let state = initialInstanceUiState;
  state = { ...state, map: { "fp-a": { destination: "Agents", selectedAgentId: undefined, statusFilter: { statusGroups: [] } } } };
  const next = instanceUiReducer(state, { type: "prune", liveFingerprints: ["fp-a"] });
  assert.equal(next, state);
});

// ---------------------------------------------------------------------------
// statusFilter —— Agents 列表状态过滤槽位(issue #56)
// ---------------------------------------------------------------------------

test("statusFilter 动作更新当前显示的过滤,不写记忆槽", () => {
  let state = setStatusFilter(initialInstanceUiState, ["needsMe"]);
  assert.deepEqual(state, {
    map: {},
    destination: "Agents",
    selectedAgentId: undefined,
    statusFilter: { statusGroups: ["needsMe"] },
  });
});

test("demo 场景:A 选“需要我” → 切 B(默认无过滤)→ 切回 A,过滤原样保留", () => {
  let state = setStatusFilter(initialInstanceUiState, ["needsMe", "failed"]);
  state = focusSwitch(state, "fp-a", "fp-b");
  // B 无记忆 → 默认不过滤;A 的过滤被记忆。
  assert.deepEqual(state.statusFilter, { statusGroups: [] });
  assert.deepEqual(state.map["fp-a"]?.statusFilter, { statusGroups: ["needsMe", "failed"] });
  const restored = focusSwitch(state, "fp-b", "fp-a");
  assert.deepEqual(restored.statusFilter, { statusGroups: ["needsMe", "failed"] });
});

test("过滤与页面/选中 Agent 独立记忆,互不覆盖", () => {
  // A:Settings 页 + 过滤;B:Agents 页 + 选中 Agent、无过滤。
  let state = selectDestination(initialInstanceUiState, "Settings");
  state = setStatusFilter(state, ["completed"]);
  state = focusSwitch(state, "fp-a", "fp-b");
  state = selectAgent(state, "agent-b1");
  state = focusSwitch(state, "fp-b", "fp-a");
  assert.equal(state.destination, "Settings");
  assert.deepEqual(state.statusFilter, { statusGroups: ["completed"] });
  assert.deepEqual(state.map["fp-b"], {
    destination: "Agents",
    selectedAgentId: "agent-b1",
    statusFilter: { statusGroups: [] },
  });
});

test("prune 清理含过滤的记忆槽(实例解绑后过滤随快照丢弃)", () => {
  let state = setStatusFilter(initialInstanceUiState, ["working"]);
  state = focusSwitch(state, "fp-a", "fp-b");
  state = instanceUiReducer(state, { type: "prune", liveFingerprints: ["fp-b"] });
  assert.equal(state.map["fp-a"], undefined);
  // 解绑后再次配对回同一实例 → 无记忆,落到默认(不过滤)。
  const restored = focusSwitch(state, "fp-b", "fp-a");
  assert.deepEqual(restored.statusFilter, { statusGroups: [] });
});

// ---------------------------------------------------------------------------
// resolveInstanceUiState
// ---------------------------------------------------------------------------

test("resolveInstanceUiState 对 null/未知 fingerprint 返回默认快照", () => {
  assert.equal(resolveInstanceUiState({}, null), DEFAULT_INSTANCE_UI_SNAPSHOT);
  assert.equal(
    resolveInstanceUiState(
      { "fp-a": { destination: "Settings", selectedAgentId: undefined, statusFilter: { statusGroups: [] } } },
      "fp-b",
    ),
    DEFAULT_INSTANCE_UI_SNAPSHOT,
  );
});
