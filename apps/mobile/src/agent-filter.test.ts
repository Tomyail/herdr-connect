import assert from "node:assert/strict";
import test from "node:test";

import type { Agent, InteractionState, TurnOutcome } from "./agent-contract";
import { agentStatus } from "./agent-status";
import {
  STATUS_GROUPS,
  NO_STATUS_FILTER,
  filterAgents,
  isStatusFilterActive,
  matchesStatusFilter,
  statusGroupFor,
  statusGroupLabelKey,
  toggleStatusGroup,
} from "./agent-filter";

const agent = (overrides: Partial<Agent> = {}): Agent => ({
  source_id: "a-1",
  display_name: "Agent",
  revision: 1,
  interaction_state: "unknown",
  turn_outcome: undefined,
  ...overrides,
});

const withState = (interaction_state: InteractionState, turn_outcome?: TurnOutcome | null): Agent =>
  agent({ interaction_state, turn_outcome, source_id: `${interaction_state}-${turn_outcome ?? "none"}` });

const ids = (...sourceIds: string[]) => new Set(sourceIds);

// ---------------------------------------------------------------------------
// statusGroupFor —— 语义状态 → 组的归并(口径与状态 pill 同源)
// ---------------------------------------------------------------------------

test("每个 interaction_state/turn_outcome/justCompleted 组合都归入正确的组", () => {
  const cases: Array<{
    agent: Agent;
    justCompleted: boolean;
    expected: "working" | "needsMe" | "completed" | "failed" | undefined;
  }> = [
    // 活动态直接归组。
    { agent: withState("working"), justCompleted: false, expected: "working" },
    { agent: withState("blocked"), justCompleted: false, expected: "needsMe" },
    { agent: withState("ready_input"), justCompleted: false, expected: "needsMe" },
    // unknown + justCompleted 瞬态优先于 turn_outcome。
    { agent: withState("unknown", "succeeded"), justCompleted: true, expected: "completed" },
    { agent: withState("unknown", "failed"), justCompleted: true, expected: "completed" },
    { agent: withState("unknown", undefined), justCompleted: true, expected: "completed" },
    // unknown 按 turn_outcome 归组。
    { agent: withState("unknown", "succeeded"), justCompleted: false, expected: "completed" },
    { agent: withState("unknown", "failed"), justCompleted: false, expected: "failed" },
    // cancelled 与空闲(idle)不属任何组。
    { agent: withState("unknown", "cancelled"), justCompleted: false, expected: undefined },
    { agent: withState("unknown", undefined), justCompleted: false, expected: undefined },
    { agent: withState("unknown", null), justCompleted: false, expected: undefined },
    // 活动态优先于残留的 turn_outcome(working 时上一轮结果已无意义)。
    { agent: withState("working", "failed"), justCompleted: false, expected: "working" },
    { agent: withState("ready_input", "cancelled"), justCompleted: true, expected: "needsMe" },
  ];
  for (const { agent: candidate, justCompleted, expected } of cases) {
    assert.equal(
      statusGroupFor(candidate, justCompleted),
      expected,
      `${candidate.interaction_state}/${candidate.turn_outcome ?? "none"}/just=${justCompleted}`,
    );
  }
});

test("归组与状态 pill 共用同一口径:有组的语义状态 pill 文案一一对应", () => {
  // 状态 pill(agentStatus)与组归并(statusGroupFor)都必须只依赖
  // semanticAgentStatus——同一输入永远同组,不存在 pill 显示“已完成”
  // 但不在 completed 组的分裂。
  const samples: Array<[Agent, boolean]> = [
    [withState("working"), false],
    [withState("blocked"), false],
    [withState("ready_input", "succeeded"), false],
    [withState("unknown", "succeeded"), false],
    [withState("unknown", "failed"), true],
    [withState("unknown", "cancelled"), false],
    [withState("unknown", undefined), false],
  ];
  const pillToGroup: Record<string, "working" | "needsMe" | "completed" | "failed" | undefined> = {
    "interaction.working": "working",
    "interaction.blocked": "needsMe",
    "interaction.ready_input": "needsMe",
    "agents.row.justCompleted": "completed",
    "interaction.succeeded": "completed",
    "interaction.failed": "failed",
    "interaction.cancelled": undefined,
    "interaction.idle": undefined,
  };
  for (const [candidate, justCompleted] of samples) {
    assert.equal(
      statusGroupFor(candidate, justCompleted),
      pillToGroup[agentStatus(candidate, justCompleted).textKey],
    );
  }
});

// ---------------------------------------------------------------------------
// matchesStatusFilter / filterAgents —— 过滤判定与计数
// ---------------------------------------------------------------------------

test("空选择 = 不过滤:任何状态(含 idle/cancelled)都通过,列表原样返回同一引用", () => {
  const agents = [
    withState("working"),
    withState("blocked"),
    withState("ready_input"),
    withState("unknown", "succeeded"),
    withState("unknown", "failed"),
    withState("unknown", "cancelled"),
    withState("unknown", undefined),
  ];
  for (const candidate of agents) {
    assert.equal(matchesStatusFilter(candidate, false, NO_STATUS_FILTER), true);
  }
  assert.equal(isStatusFilterActive(NO_STATUS_FILTER), false);
  // 不拷贝:调用方可安全把结果作为 FlatList data。
  assert.equal(filterAgents(agents, ids(), NO_STATUS_FILTER), agents);
});

test("needsMe 组内 OR:blocked 与 ready_input 都保留", () => {
  const filter = { statusGroups: ["needsMe"] as const };
  const blocked = withState("blocked");
  const readyInput = withState("ready_input");
  const working = withState("working");
  const result = filterAgents([working, blocked, readyInput], ids(), filter);
  assert.deepEqual(result.map((candidate) => candidate.source_id), [
    blocked.source_id,
    readyInput.source_id,
  ]);
});

test("completed 组同时覆盖“刚完成”瞬态与 reported succeeded", () => {
  const filter = { statusGroups: ["completed"] as const };
  const justCompleted = withState("unknown", undefined); // 无 outcome,仅瞬态标记
  const reported = withState("unknown", "succeeded");
  const result = filterAgents([justCompleted, reported], ids(justCompleted.source_id), filter);
  assert.deepEqual(result.map((candidate) => candidate.source_id), [
    justCompleted.source_id,
    reported.source_id,
  ]);
  // 瞬态按 source_id 精确命中:同列表中未标记的空闲 Agent 不进 completed。
  const other = withState("unknown", undefined);
  assert.equal(matchesStatusFilter(other, false, filter), false);
});

test("多组 OR:working + failed;未选中的组与 idle/cancelled 一并过滤", () => {
  const filter = { statusGroups: ["working", "failed"] as const };
  const working = withState("working");
  const blocked = withState("blocked");
  const failed = withState("unknown", "failed");
  const cancelled = withState("unknown", "cancelled");
  const idle = withState("unknown", undefined);
  const result = filterAgents([working, blocked, failed, cancelled, idle], ids(), filter);
  assert.deepEqual(result.map((candidate) => candidate.source_id), [
    working.source_id,
    failed.source_id,
  ]);
});

test("选中任一组时,cancelled 与 idle 即使其他条件不同也一律排除", () => {
  for (const group of STATUS_GROUPS) {
    const filter = { statusGroups: [group] };
    assert.equal(matchesStatusFilter(withState("unknown", "cancelled"), false, filter), false, group);
    assert.equal(matchesStatusFilter(withState("unknown", undefined), false, filter), false, group);
    // 瞬态可救活空闲 Agent(归入 completed)——仅当选中 completed 时。
    assert.equal(
      matchesStatusFilter(withState("unknown", undefined), true, filter),
      group === "completed",
      group,
    );
  }
});

test("filterAgents 保序过滤并按 source_id 查瞬态;计数 X/Y 由长度对比得出", () => {
  const blocked = withState("blocked");
  const working = withState("working");
  const readyInput = withState("ready_input");
  const succeeded = withState("unknown", "succeeded");
  const idle = withState("unknown", undefined);
  const agents = [blocked, working, readyInput, succeeded, idle];
  const shown = filterAgents(agents, ids(), { statusGroups: ["needsMe", "completed"] });
  // 屏显“显示 X/Y”:X = shown.length, Y = agents.length。
  assert.equal(shown.length, 3);
  assert.equal(agents.length, 5);
  assert.deepEqual(shown, [blocked, readyInput, succeeded]);
});

test("无匹配时返回空数组(空占位 + 清除过滤入口)", () => {
  const agents = [withState("working"), withState("unknown", "cancelled")];
  assert.deepEqual(filterAgents(agents, ids(), { statusGroups: ["failed"] }), []);
});

// ---------------------------------------------------------------------------
// toggleStatusGroup —— chips 多选的状态更新
// ---------------------------------------------------------------------------

test("toggleStatusGroup 多选切换并保持固定组序", () => {
  // 乱序选择 → 规范化为 STATUS_GROUPS 序。
  let filter = toggleStatusGroup(NO_STATUS_FILTER, "failed");
  filter = toggleStatusGroup(filter, "working");
  assert.deepEqual(filter.statusGroups, ["working", "failed"]);
  // 组内 OR 不受选择顺序影响。
  filter = toggleStatusGroup(filter, "needsMe");
  assert.deepEqual(filter.statusGroups, ["working", "needsMe", "failed"]);
  // 再点取消单组。
  filter = toggleStatusGroup(filter, "working");
  assert.deepEqual(filter.statusGroups, ["needsMe", "failed"]);
});

test("全部取消后回到 NO_STATUS_FILTER 同构(空数组 = 不过滤)", () => {
  let filter = toggleStatusGroup(NO_STATUS_FILTER, "needsMe");
  filter = toggleStatusGroup(filter, "needsMe");
  assert.deepEqual(filter, NO_STATUS_FILTER);
  assert.equal(isStatusFilterActive(filter), false);
});

// ---------------------------------------------------------------------------
// 元数据 —— 组标签键与展示顺序
// ---------------------------------------------------------------------------

test("每个组都有 chip 文案键,顺序固定为 工作中/需要我/已完成/失败", () => {
  assert.deepEqual(STATUS_GROUPS, ["working", "needsMe", "completed", "failed"]);
  for (const group of STATUS_GROUPS) {
    assert.ok(statusGroupLabelKey[group].startsWith("agents.filter.group."));
    assert.ok(typeof statusGroupLabelKey[group] === "string" && statusGroupLabelKey[group].length > 0);
  }
});
