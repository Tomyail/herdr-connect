import assert from "node:assert/strict";
import test from "node:test";

import type { Agent, InteractionState, TurnOutcome } from "./agent-contract";
import { agentStatus } from "./agent-status";
import {
  STATUS_GROUPS,
  NO_FILTER,
  UNNAMED_WORKSPACE_KEY,
  activeFilterChipCount,
  enumerateWorkspaceOptions,
  filterAgents,
  isFilterActive,
  matchesFilter,
  pruneWorkspaces,
  statusGroupFor,
  statusGroupLabelKey,
  toggleFavoritesOnly,
  toggleStatusGroup,
  toggleWorkspace,
  workspaceKeyFor,
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

const withWorkspace = (workspace_label: string | undefined, source_id: string): Agent =>
  agent({ workspace_label, source_id, interaction_state: "working" });

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
// workspaceKeyFor —— workspace 归一(issue #57)
// ---------------------------------------------------------------------------

test("workspaceKeyFor:非空 label 取 trim 后的值,缺失/全空白归入未命名 sentinel", () => {
  assert.equal(workspaceKeyFor(withWorkspace("herdr-connect", "a")), "herdr-connect");
  assert.equal(workspaceKeyFor(withWorkspace("  herdr-connect  ", "b")), "herdr-connect");
  assert.equal(workspaceKeyFor(withWorkspace("", "c")), UNNAMED_WORKSPACE_KEY);
  assert.equal(workspaceKeyFor(withWorkspace("   ", "d")), UNNAMED_WORKSPACE_KEY);
  assert.equal(workspaceKeyFor(withWorkspace(undefined, "e")), UNNAMED_WORKSPACE_KEY);
});

test("空白差异视为同一 workspace(trim 后合并计数)", () => {
  const options = enumerateWorkspaceOptions([
    withWorkspace("alpha", "a"),
    withWorkspace(" alpha ", "b"),
    withWorkspace("beta", "c"),
  ]);
  assert.deepEqual(
    options.map((option) => [option.key, option.count]),
    [["alpha", 2], ["beta", 1]],
  );
});

// ---------------------------------------------------------------------------
// matchesFilter / filterAgents —— 过滤判定与计数
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
    assert.equal(matchesFilter(candidate, false, NO_FILTER), true);
  }
  assert.equal(isFilterActive(NO_FILTER), false);
  assert.equal(activeFilterChipCount(NO_FILTER), 0);
  // 不拷贝:调用方可安全把结果作为 FlatList data。
  assert.equal(filterAgents(agents, ids(), NO_FILTER), agents);
});

test("needsMe 组内 OR:blocked 与 ready_input 都保留", () => {
  const filter = { statusGroups: ["needsMe"] as const, workspaces: [], favoritesOnly: false };
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
  const filter = { statusGroups: ["completed"] as const, workspaces: [], favoritesOnly: false };
  const justCompleted = withState("unknown", undefined); // 无 outcome,仅瞬态标记
  const reported = withState("unknown", "succeeded");
  const result = filterAgents([justCompleted, reported], ids(justCompleted.source_id), filter);
  assert.deepEqual(result.map((candidate) => candidate.source_id), [
    justCompleted.source_id,
    reported.source_id,
  ]);
  // 瞬态按 source_id 精确命中:同列表中未标记的空闲 Agent 不进 completed。
  const other = withState("unknown", undefined);
  assert.equal(matchesFilter(other, false, filter), false);
});

test("多组 OR:working + failed;未选中的组与 idle/cancelled 一并过滤", () => {
  const filter = { statusGroups: ["working", "failed"] as const, workspaces: [], favoritesOnly: false };
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
    const filter = { statusGroups: [group], workspaces: [], favoritesOnly: false };
    assert.equal(matchesFilter(withState("unknown", "cancelled"), false, filter), false, group);
    assert.equal(matchesFilter(withState("unknown", undefined), false, filter), false, group);
    // 瞬态可救活空闲 Agent(归入 completed)——仅当选中 completed 时。
    assert.equal(
      matchesFilter(withState("unknown", undefined), true, filter),
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
  const shown = filterAgents(agents, ids(), { statusGroups: ["needsMe", "completed"], workspaces: [], favoritesOnly: false });
  // 屏显“显示 X/Y”:X = shown.length, Y = agents.length。
  assert.equal(shown.length, 3);
  assert.equal(agents.length, 5);
  assert.deepEqual(shown, [blocked, readyInput, succeeded]);
});

test("无匹配时返回空数组(空占位 + 清除过滤入口)", () => {
  const agents = [withState("working"), withState("unknown", "cancelled")];
  assert.deepEqual(filterAgents(agents, ids(), { statusGroups: ["failed"], workspaces: [], favoritesOnly: false }), []);
});

// ---------------------------------------------------------------------------
// 双维组合 —— 组内 OR、组间 AND(issue #57)
// ---------------------------------------------------------------------------

test("demo 场景:workspace X + 状态“需要我”只剩该 workspace 里受阻/等待输入的 Agent", () => {
  const inXBlocked = agent({
    source_id: "x-blocked",
    workspace_label: "herdr-connect",
    interaction_state: "blocked",
  });
  const inXReady = agent({
    source_id: "x-ready",
    workspace_label: "herdr-connect",
    interaction_state: "ready_input",
  });
  const inXWorking = agent({
    source_id: "x-working",
    workspace_label: "herdr-connect",
    interaction_state: "working",
  });
  const outXBlocked = agent({
    source_id: "y-blocked",
    workspace_label: "other-repo",
    interaction_state: "blocked",
  });
  const outXWorking = agent({
    source_id: "y-working",
    workspace_label: "other-repo",
    interaction_state: "working",
  });
  const result = filterAgents(
    [inXBlocked, inXReady, inXWorking, outXBlocked, outXWorking],
    ids(),
    { statusGroups: ["needsMe"], workspaces: ["herdr-connect"], favoritesOnly: false },
  );
  // 组间 AND:必须同时落在选中 workspace 与选中状态组内。
  assert.deepEqual(result.map((candidate) => candidate.source_id), ["x-blocked", "x-ready"]);
});

test("双维都激活时组间 AND:任一维不满足即排除", () => {
  const a = withWorkspace("alpha", "a"); // working(基线工厂)
  const b = agent({ source_id: "b", workspace_label: "beta", interaction_state: "blocked" });
  const c = agent({ source_id: "c", workspace_label: "alpha", interaction_state: "unknown" }); // idle
  const result = filterAgents([a, b, c], ids(), {
    statusGroups: ["working", "needsMe"],
    workspaces: ["alpha", "beta"],
    favoritesOnly: false,
  });
  // a:状态 working ✓ + workspace alpha ✓;
  // b:blocked(needsMe)✓ + beta ✓;
  // c:idle 不属状态组 ✗。
  assert.deepEqual(result.map((candidate) => candidate.source_id), ["a", "b"]);
});

test("只选 workspace 维时状态维直通(idle/cancelled 也保留)", () => {
  const working = withWorkspace("alpha", "a");
  const idle = agent({ source_id: "b", workspace_label: "alpha", interaction_state: "unknown" });
  const cancelled = agent({
    source_id: "c",
    workspace_label: "alpha",
    interaction_state: "unknown",
    turn_outcome: "cancelled",
  });
  const other = withWorkspace("beta", "d");
  const result = filterAgents([working, idle, cancelled, other], ids(), {
    statusGroups: [],
    workspaces: ["alpha"],
    favoritesOnly: false,
  });
  // 状态维未选 = 不筛状态:alpha 里所有状态(含 idle/cancelled)都保留。
  assert.deepEqual(result.map((candidate) => candidate.source_id), ["a", "b", "c"]);
});

test("workspace 组内 OR:多个 workspace 同时选中", () => {
  const alpha1 = withWorkspace("alpha", "a");
  const beta1 = withWorkspace("beta", "b");
  const gamma1 = withWorkspace("gamma", "c");
  const result = filterAgents([alpha1, beta1, gamma1], ids(), {
    statusGroups: [],
    workspaces: ["alpha", "gamma"],
    favoritesOnly: false,
  });
  assert.deepEqual(result.map((candidate) => candidate.source_id), ["a", "c"]);
});

test("只选状态维时 workspace 维直通", () => {
  const alpha1 = withWorkspace("alpha", "a");
  const beta1 = withWorkspace("beta", "b");
  const result = filterAgents([alpha1, beta1], ids(), { statusGroups: ["working"], workspaces: [], favoritesOnly: false });
  assert.deepEqual(result.map((candidate) => candidate.source_id), ["a", "b"]);
});

test("选中未命名 workspace 时空 label Agent 保留,有 label 的排除", () => {
  const unnamed1 = withWorkspace(undefined, "a");
  const unnamed2 = withWorkspace("  ", "b"); // 全空白同样归未命名组
  const named = withWorkspace("alpha", "c");
  const result = filterAgents([unnamed1, unnamed2, named], ids(), {
    statusGroups: [],
    workspaces: [UNNAMED_WORKSPACE_KEY],
    favoritesOnly: false,
  });
  assert.deepEqual(result.map((candidate) => candidate.source_id), ["a", "b"]);
});

test("悬空 workspace 选择:选中的 workspace 不在快照中时匹配不到任何 Agent", () => {
  const a = withWorkspace("alpha", "a");
  const result = filterAgents([a], ids(), { statusGroups: [], workspaces: ["ghost"], favoritesOnly: false });
  assert.deepEqual(result, []);
  // 组合场景:悬空 workspace + 有效状态组 → 组间 AND 后同样为空。
  assert.deepEqual(
    filterAgents([a], ids(), { statusGroups: ["working"], workspaces: ["ghost"], favoritesOnly: false }),
    [],
  );
});

test("activeFilterChipCount 汇总两维选中数(激活徽标)", () => {
  assert.equal(
    activeFilterChipCount({ statusGroups: ["working", "failed"], workspaces: ["alpha"], favoritesOnly: false }),
    3,
  );
  assert.equal(activeFilterChipCount({ statusGroups: [], workspaces: ["alpha", "beta"], favoritesOnly: false }), 2);
});

// ---------------------------------------------------------------------------
// enumerateWorkspaceOptions —— 枚举、全量计数、降序排序
// ---------------------------------------------------------------------------

test("枚举 workspace:全量计数 + 数量降序,平局按名称字母序打破", () => {
  const agents = [
    withWorkspace("alpha", "a"),
    withWorkspace("beta", "b"),
    withWorkspace("beta", "c"),
    withWorkspace("gamma", "d"),
    withWorkspace("beta", "e"),
    withWorkspace("delta", "f"),
    withWorkspace("alpha", "g"),
  ];
  // beta(3) > alpha(2) > delta(1) = gamma(1)(字母序 delta 在前)。
  assert.deepEqual(
    enumerateWorkspaceOptions(agents).map((option) => ({ key: option.key, count: option.count })),
    [
      { key: "beta", count: 3 },
      { key: "alpha", count: 2 },
      { key: "delta", count: 1 },
      { key: "gamma", count: 1 },
    ],
  );
});

test("排序与输入顺序无关(稳定平局)", () => {
  const byAlpha = [withWorkspace("alpha", "a"), withWorkspace("beta", "b")];
  const byBeta = [withWorkspace("beta", "b"), withWorkspace("alpha", "a")];
  assert.deepEqual(
    enumerateWorkspaceOptions(byAlpha).map((option) => option.key),
    enumerateWorkspaceOptions(byBeta).map((option) => option.key),
  );
});

test("计数是全量口径:签名不含过滤选择,不受另一维过滤联动", () => {
  // enumerateWorkspaceOptions 只接收 agents——即使调用方状态维已过滤,
  // 传全量列表得到的每个 workspace 计数就是全量计数。这里锁定:
  // 同一列表在过滤选择变化前后输出一致。
  const agents = [
    withWorkspace("alpha", "a"),
    agent({ source_id: "b", workspace_label: "alpha", interaction_state: "blocked" }),
    withWorkspace("beta", "c"),
  ];
  const before = enumerateWorkspaceOptions(agents);
  // 模拟状态维选择变化(needsMe)——枚举输出不变。
  const after = enumerateWorkspaceOptions(agents);
  assert.deepEqual(before, after);
  assert.deepEqual(
    before.map((option) => [option.key, option.count]),
    [["alpha", 2], ["beta", 1]],
  );
});

test("未命名 workspace 参与 enum,标记 isUnnamed 供 UI 走 i18n 文案", () => {
  const options = enumerateWorkspaceOptions([
    withWorkspace("alpha", "a"),
    withWorkspace(undefined, "b"),
    withWorkspace("", "c"),
  ]);
  const unnamed = options.find((option) => option.isUnnamed);
  assert.equal(unnamed?.key, UNNAMED_WORKSPACE_KEY);
  assert.equal(unnamed?.count, 2);
  assert.equal(options.filter((option) => option.isUnnamed).length, 1);
  // 具名组不带 isUnnamed。
  assert.equal(options.find((option) => option.key === "alpha")?.isUnnamed, false);
});

test("空快照枚举为空数组", () => {
  assert.deepEqual(enumerateWorkspaceOptions([]), []);
});

// ---------------------------------------------------------------------------
// toggleStatusGroup / toggleWorkspace —— chips 多选的状态更新
// ---------------------------------------------------------------------------

test("toggleStatusGroup 多选切换并保持固定组序,workspace 维原样保留", () => {
  // 乱序选择 → 规范化为 STATUS_GROUPS 序。
  let filter = toggleStatusGroup(NO_FILTER, "failed");
  filter = toggleStatusGroup(filter, "working");
  assert.deepEqual(filter.statusGroups, ["working", "failed"]);
  // 组内 OR 不受选择顺序影响。
  filter = toggleStatusGroup(filter, "needsMe");
  assert.deepEqual(filter.statusGroups, ["working", "needsMe", "failed"]);
  // 再点取消单组。
  filter = toggleStatusGroup(filter, "working");
  assert.deepEqual(filter.statusGroups, ["needsMe", "failed"]);
});

test("toggleStatusGroup 不触碰 workspace 维", () => {
  const filter = { statusGroups: [] as const, workspaces: ["alpha"], favoritesOnly: false };
  const next = toggleStatusGroup(filter, "working");
  assert.deepEqual(next.statusGroups, ["working"]);
  assert.deepEqual(next.workspaces, ["alpha"]);
});

test("toggleWorkspace 多选切换,重复点取消;状态维原样保留", () => {
  let filter = toggleWorkspace(NO_FILTER, "alpha");
  filter = toggleWorkspace(filter, "beta");
  assert.deepEqual(filter.workspaces, ["alpha", "beta"]);
  assert.deepEqual(filter.statusGroups, []);
  // 取消一个。
  filter = toggleWorkspace(filter, "alpha");
  assert.deepEqual(filter.workspaces, ["beta"]);
  // 再选回来:追加到末尾(保留选择时序,渲染以枚举集合为准)。
  filter = toggleWorkspace(filter, "alpha");
  assert.deepEqual(filter.workspaces, ["beta", "alpha"]);
  // toggleWorkspace 不触碰状态维。
  filter = { ...filter, statusGroups: ["working"] };
  filter = toggleWorkspace(filter, "beta");
  assert.deepEqual(filter.statusGroups, ["working"]);
});

test("全部取消后回到 NO_FILTER 同构(两维皆空 = 不过滤)", () => {
  let filter = toggleStatusGroup(NO_FILTER, "needsMe");
  filter = toggleWorkspace(filter, "alpha");
  filter = toggleStatusGroup(filter, "needsMe");
  filter = toggleWorkspace(filter, "alpha");
  assert.deepEqual(filter, NO_FILTER);
  assert.equal(isFilterActive(filter), false);
});

test("toggleWorkspace 同名重复选择去重(组内 OR 无重复项)", () => {
  const filter = toggleWorkspace(
    { statusGroups: [], workspaces: ["alpha"], favoritesOnly: false },
    "alpha",
  );
  assert.deepEqual(filter.workspaces, []);
});

// ---------------------------------------------------------------------------
// pruneWorkspaces —— 悬空选择自动剔除
// ---------------------------------------------------------------------------

test("pruneWorkspaces 剔除快照中已消失的 workspace,保留仍存活的", () => {
  const filter = { statusGroups: ["working"] as const, workspaces: ["alpha", "ghost", "beta"], favoritesOnly: false };
  const pruned = pruneWorkspaces(filter, ["alpha", "beta", "gamma"]);
  assert.deepEqual(pruned.workspaces, ["alpha", "beta"]);
  // 状态维不受影响。
  assert.deepEqual(pruned.statusGroups, ["working"]);
});

test("pruneWorkspaces 无需剔除时返回原引用(调用方可跳过 dispatch)", () => {
  const filter = { statusGroups: [] as const, workspaces: ["alpha"], favoritesOnly: false };
  assert.equal(pruneWorkspaces(filter, ["alpha", "beta"]), filter);
});

test("pruneWorkspaces 空选择直通原引用", () => {
  assert.equal(pruneWorkspaces(NO_FILTER, []), NO_FILTER);
});

test("pruneWorkspaces 全部悬空时清空 workspace 维(回到该维不过滤)", () => {
  const filter = { statusGroups: ["needsMe"] as const, workspaces: ["ghost-1", "ghost-2"], favoritesOnly: false };
  const pruned = pruneWorkspaces(filter, ["alpha"]);
  assert.deepEqual(pruned.workspaces, []);
  assert.deepEqual(pruned.statusGroups, ["needsMe"]);
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

// ---------------------------------------------------------------------------
// 收藏维(issue #58)—— 三维 AND:收藏 × 状态 × workspace,各维直通
// ---------------------------------------------------------------------------

test("收藏维关闭 = 直通:收藏集合为空也不影响,任何状态都通过", () => {
  const filter = { statusGroups: [] as const, workspaces: [] as const, favoritesOnly: false };
  for (const candidate of [withState("working"), withState("blocked"), withState("unknown", "cancelled"), withState("unknown", undefined)]) {
    assert.equal(matchesFilter(candidate, false, filter, []), true);
  }
  assert.equal(isFilterActive(filter), false);
});

test("仅开收藏维:只保留收藏集合内的 Agent,其余两维直通(收藏的 idle/cancelled 也保留)", () => {
  const working = withWorkspace("alpha", "a"); // 收藏
  const idle = agent({ source_id: "b", workspace_label: "beta", interaction_state: "unknown" }); // 收藏
  const cancelled = agent({
    source_id: "c",
    workspace_label: "beta",
    interaction_state: "unknown",
    turn_outcome: "cancelled",
  }); // 未收藏
  const other = withWorkspace("gamma", "d"); // 未收藏
  const filter = toggleFavoritesOnly(NO_FILTER);
  // 收集维不约束状态/ workspace:idle 收藏项同样保留。
  const result = filterAgents([working, idle, cancelled, other], ids(), filter, ["b", "a"]);
  assert.deepEqual(result.map((candidate) => candidate.source_id), ["a", "b"]);
});

test("仅开收藏维且收藏集合为空:无匹配(空占位 + 清除过滤入口)", () => {
  const filter = toggleFavoritesOnly(NO_FILTER);
  assert.deepEqual(filterAgents([withState("working")], ids(), filter, []), []);
});

test("三维 AND:收藏 × 需要我 × workspace 一步聚焦“重要的 Agent 里谁需要我处理”", () => {
  // 5 个 Agent:收藏与状态/workspace 各自交叉。
  const favNeedsInX = agent({ source_id: "fav-x-blocked", workspace_label: "herdr-connect", interaction_state: "blocked" });
  const favNeedsOutX = agent({ source_id: "fav-y-blocked", workspace_label: "other-repo", interaction_state: "ready_input" });
  const favWorkingInX = withWorkspace("herdr-connect", "fav-x-working");
  const unfavNeedsInX = agent({ source_id: "unfav-x-blocked", workspace_label: "herdr-connect", interaction_state: "blocked" });
  const unfavWorkingOutX = withWorkspace("other-repo", "unfav-y-working");
  const filter = {
    statusGroups: ["needsMe"] as const,
    workspaces: ["herdr-connect"] as const,
    favoritesOnly: true,
  };
  const result = filterAgents(
    [favNeedsInX, favNeedsOutX, favWorkingInX, unfavNeedsInX, unfavWorkingOutX],
    ids(),
    filter,
    [favNeedsInX.source_id, favNeedsOutX.source_id, favWorkingInX.source_id],
  );
  // 交集:必须同时是收藏 + needsMe + herdr-connect。
  assert.deepEqual(result.map((candidate) => candidate.source_id), ["fav-x-blocked"]);
});

test("三维中任一维不满足即排除(AND 组合的完备交叉)", () => {
  const favNeedsInX = agent({ source_id: "ok", workspace_label: "x", interaction_state: "blocked" });
  const favWorkingInX = withWorkspace("x", "wrong-status");
  const favNeedsOutX = agent({ source_id: "wrong-workspace", workspace_label: "y", interaction_state: "blocked" });
  const unfavNeedsInX = agent({ source_id: "unfavorited", workspace_label: "x", interaction_state: "blocked" });
  const filter = {
    statusGroups: ["needsMe"] as const,
    workspaces: ["x"] as const,
    favoritesOnly: true,
  };
  const result = filterAgents(
    [favNeedsInX, favWorkingInX, favNeedsOutX, unfavNeedsInX],
    ids(),
    filter,
    [favNeedsInX.source_id, favWorkingInX.source_id, favNeedsOutX.source_id],
  );
  assert.deepEqual(result.map((candidate) => candidate.source_id), ["ok"]);
});

test("收藏维与状态维组合:状态维选中时收藏的 idle 仍被状态维排除", () => {
  // 收藏维不教嗂状态语义:idle 不属任何状态组,选中任一组即被排除——
  // 两维各自独立判定后 AND。
  const favIdle = agent({ source_id: "fav-idle", workspace_label: "x", interaction_state: "unknown" });
  const favBlocked = agent({ source_id: "fav-blocked", workspace_label: "x", interaction_state: "blocked" });
  const filter = {
    statusGroups: ["needsMe"] as const,
    workspaces: [] as const,
    favoritesOnly: true,
  };
  const result = filterAgents([favIdle, favBlocked], ids(), filter, [favIdle.source_id, favBlocked.source_id]);
  assert.deepEqual(result.map((candidate) => candidate.source_id), ["fav-blocked"]);
});

test("toggleFavoritesOnly 翻转开关并保留另两维;往返回到 NO_FILTER 同构", () => {
  let filter = toggleStatusGroup(NO_FILTER, "working");
  filter = toggleWorkspace(filter, "alpha");
  filter = toggleFavoritesOnly(filter);
  assert.deepEqual(filter, { statusGroups: ["working"], workspaces: ["alpha"], favoritesOnly: true });
  assert.equal(isFilterActive(filter), true);
  filter = toggleFavoritesOnly(filter);
  assert.equal(filter.favoritesOnly, false);
  assert.deepEqual(filter.statusGroups, ["working"]); // 另两维不受开关翻转影响
});

test("激活态徽标计入收藏开关:仅开收藏维时激活且计数为 1", () => {
  const filter = toggleFavoritesOnly(NO_FILTER);
  assert.equal(isFilterActive(filter), true);
  assert.equal(activeFilterChipCount(filter), 1);
  assert.equal(
    activeFilterChipCount({ statusGroups: ["working", "failed"], workspaces: ["alpha"], favoritesOnly: true }),
    4,
  );
  // 无选择无开关 = 不激活、零计数。
  assert.equal(isFilterActive(NO_FILTER), false);
  assert.equal(activeFilterChipCount(NO_FILTER), 0);
});
