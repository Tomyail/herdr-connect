package herdrsource_test

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/Tomyail/herdr-connect/internal/herdrsource"
)

func TestFakeProvider表达完整生命周期与能力矩阵(t *testing.T) {
	t.Parallel()

	caps := herdrsource.Capabilities{
		ObserveAgents:           true,
		IncrementalChanges:      true,
		TrustedInteractionState: true,
		TrustedTurnOutcome:      true,
		ReadOutput:              true,
		SendPrompt:              true,
		Interrupt:               true,
	}
	fake := herdrsource.NewFake("fake", caps, herdrsource.Snapshot{
		Cursor: "1",
		Agents: []herdrsource.AgentObservation{{
			SourceID:         "source-agent-1",
			DisplayName:      "构建 Agent",
			TurnID:           "turn-1",
			Revision:         1,
			InteractionState: herdrsource.InteractionWorking,
		}},
	})
	fake.Append(herdrsource.ChangeBatch{
		AfterCursor: "2",
		Changes: []herdrsource.Change{{
			Kind: herdrsource.ChangeUpsert,
			Agent: herdrsource.AgentObservation{
				SourceID:         "source-agent-1",
				DisplayName:      "构建 Agent",
				TurnID:           "turn-1",
				Revision:         2,
				InteractionState: herdrsource.InteractionBlocked,
			},
		}},
	})

	ctx := context.Background()
	gotCaps, err := fake.Capabilities(ctx)
	if err != nil {
		t.Fatalf("读取能力: %v", err)
	}
	if gotCaps != caps {
		t.Fatalf("能力矩阵 = %#v, want %#v", gotCaps, caps)
	}
	batch, err := fake.Changes(ctx, "1")
	if err != nil {
		t.Fatalf("读取增量: %v", err)
	}
	if len(batch.Changes) != 1 || batch.Changes[0].Agent.InteractionState != herdrsource.InteractionBlocked {
		t.Fatalf("增量 = %#v", batch)
	}
}

func Test当前Herdr适配器映射Agent状态(t *testing.T) {
	t.Parallel()

	fixture, err := os.ReadFile("testdata/herdr-v0.7-agent-list.json")
	if err != nil {
		t.Fatalf("读取 fixture: %v", err)
	}
	adapter := herdrsource.NewHerdrCLIAdapter(stubRunner{output: fixture})

	snapshot, err := adapter.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("读取快照: %v", err)
	}
	if !snapshot.Online || len(snapshot.Agents) != 1 {
		t.Fatalf("快照 = %#v", snapshot)
	}
	agent := snapshot.Agents[0]
	if agent.SourceID != "pane-1" || agent.Revision != 1 {
		t.Fatalf("来源身份或 revision = %#v", agent)
	}
	if agent.InteractionState != herdrsource.InteractionUnknown {
		t.Fatalf("interaction state = %q, want unknown", agent.InteractionState)
	}
	if agent.TurnOutcome == nil || *agent.TurnOutcome != herdrsource.OutcomeSucceeded {
		t.Fatalf("turn outcome = %v, want succeeded", agent.TurnOutcome)
	}
	caps, err := adapter.Capabilities(context.Background())
	if err != nil {
		t.Fatalf("读取能力: %v", err)
	}
	if !caps.ObserveAgents || caps.TrustedInteractionState || caps.TrustedTurnOutcome || caps.SendPrompt || caps.Interrupt {
		t.Fatalf("能力矩阵不保守: %#v", caps)
	}
}

func Test当前Herdr适配器映射进行中空闲和未知状态(t *testing.T) {
	t.Parallel()

	adapter := herdrsource.NewHerdrCLIAdapter(routingRunner{outputs: map[string]string{
		"agent list": `{"result":{"type":"agent_list","agents":[
			{"pane_id":"working","agent_status":"working"},
			{"pane_id":"idle","agent_status":"idle"},
			{"pane_id":"future","agent_status":"future_status"}
		]}}`,
	}})
	snapshot, err := adapter.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("读取快照: %v", err)
	}
	wants := []herdrsource.InteractionState{
		herdrsource.InteractionWorking,
		herdrsource.InteractionReadyInput,
		herdrsource.InteractionUnknown,
	}
	for index, want := range wants {
		if got := snapshot.Agents[index].InteractionState; got != want {
			t.Fatalf("第 %d 个 interaction state = %q, want %q", index, got, want)
		}
		if snapshot.Agents[index].TurnOutcome != nil {
			t.Fatalf("第 %d 个 turn outcome = %v, want nil", index, snapshot.Agents[index].TurnOutcome)
		}
	}
}

func Test当前Herdr适配器用Workspace与Tab区分Agent(t *testing.T) {
	t.Parallel()

	adapter := herdrsource.NewHerdrCLIAdapter(routingRunner{outputs: map[string]string{
		"agent list":              `{"result":{"type":"agent_list","agents":[{"pane_id":"wR:p1K","agent":"codex","workspace_id":"wR","tab_id":"wR:t8","revision":5},{"pane_id":"wV:p2K","agent":"claude","workspace_id":"wV","tab_id":"wV:t1","revision":2}]}}`,
		"workspace list":          `{"result":{"type":"workspace_list","workspaces":[{"workspace_id":"wR","label":"herdr-connect"},{"workspace_id":"wV","label":"obsidian"}]}}`,
		"tab list --workspace wR": `{"result":{"type":"tab_list","tabs":[{"tab_id":"wR:t8","label":"demo-ios"}]}}`,
		"tab list --workspace wV": `{"result":{"type":"tab_list","tabs":[{"tab_id":"wV:t1","label":"master"}]}}`,
	}})

	snapshot, err := adapter.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("读取快照: %v", err)
	}
	if got := snapshot.Agents[0].DisplayName; got != "herdr-connect · demo-ios · codex" {
		t.Fatalf("第一个 Agent 名称 = %q", got)
	}
	if got := snapshot.Agents[0]; got.WorkspaceLabel != "herdr-connect" || got.TabLabel != "demo-ios" || got.AgentName != "codex" {
		t.Fatalf("第一个 Agent 结构化名称 = %#v", got)
	}
	if got := snapshot.Agents[1].DisplayName; got != "obsidian · master · claude" {
		t.Fatalf("第二个 Agent 名称 = %q", got)
	}
}

func Test当前Herdr适配器通过PaneID切换Agent(t *testing.T) {
	t.Parallel()

	runner := &recordingRunner{outputs: map[string]string{"agent focus wR:p1K": `{}`}}
	adapter := herdrsource.NewHerdrCLIAdapter(runner)
	if err := adapter.FocusAgent(context.Background(), "wR:p1K"); err != nil {
		t.Fatalf("切换 Agent: %v", err)
	}
	if len(runner.calls) != 1 || runner.calls[0] != "agent focus wR:p1K" {
		t.Fatalf("命令 = %#v", runner.calls)
	}
}

// TestHerdrAdapterInterruptSendsControlCViaPaneSendKeys 验证 Interrupt 的 CLI
// 调用形状：sourceID 就是 pane_id，直接 `pane send-keys <sourceID> C-c`，不再
// 经过 `agent get` 转换（herdr 0.8 起 `agent get` 也只认 pane_id，terminal_id
// 会 agent_not_found，见 herdr_cli.go Snapshot 的注释）。
//
// 注意：本测试只断言“调用了预期子命令+参数”，不断言 herdr CLI 真的会发 SIGINT
// ——后者我在 herdr --help / pane send-keys 上实测过当前版本不支持 C-c 解释
// （见 herdr_cli.go Interrupt 的实现注释）。一旦 herdr 推出专用 interrupt 子命令，
// 本测试的期望命令需同步修改。
func TestHerdrAdapterInterruptSendsControlCViaPaneSendKeys(t *testing.T) {
	t.Parallel()

	runner := &recordingRunner{outputs: map[string]string{
		"pane send-keys wR:p1K C-c": `{}`,
	}}
	adapter := herdrsource.NewHerdrCLIAdapter(runner)
	if err := adapter.Interrupt(context.Background(), "wR:p1K"); err != nil {
		t.Fatalf("中断 Agent: %v", err)
	}
	wantCalls := []string{
		"pane send-keys wR:p1K C-c",
	}
	if strings.Join(runner.calls, "\n") != strings.Join(wantCalls, "\n") {
		t.Fatalf("命令 = %#v, want %#v", runner.calls, wantCalls)
	}
}

func TestHerdrAdapterInterruptRejectsEmptySourceID(t *testing.T) {
	t.Parallel()

	runner := &recordingRunner{outputs: map[string]string{}}
	adapter := herdrsource.NewHerdrCLIAdapter(runner)
	if err := adapter.Interrupt(context.Background(), ""); err == nil {
		t.Fatalf("空 sourceID 应报错")
	}
	if len(runner.calls) != 0 {
		t.Fatalf("空 sourceID 不应触发任何 CLI 调用，实际 = %#v", runner.calls)
	}
}

// Test当前Herdr适配器读取历史并通过Pane提交消息 覆盖 ReadAgentHistory 的真实
// CLI 输出形状：`agent read` 成功时直接把纯文本写到 stdout（没有 JSON 包
// 装），revision 要另外调 `agent get` 拿；truncated 由返回行数是否达到请求
// 行数推断（这里请求 3 行、返回 3 行 → 判定为可能被截断）。
func Test当前Herdr适配器读取历史并通过Pane提交消息(t *testing.T) {
	t.Parallel()

	runner := &recordingRunner{outputs: map[string]string{
		"agent read wR:p1K --source recent-unwrapped --lines 3": "line1\nline2\nline3",
		"agent get wR:p1K":        `{"result":{"type":"agent_info","agent":{"revision":9}}}`,
		"pane run wR:p1K 继续完成演示": `{}`,
	}}
	adapter := herdrsource.NewHerdrCLIAdapter(runner)
	history, err := adapter.ReadAgentHistory(context.Background(), "wR:p1K", 3)
	if err != nil {
		t.Fatalf("读取历史: %v", err)
	}
	if history.Text != "line1\nline2\nline3" || history.Revision != 9 || !history.Truncated {
		t.Fatalf("历史 = %#v", history)
	}
	if err := adapter.SendAgentMessage(context.Background(), "wR:p1K", "继续完成演示"); err != nil {
		t.Fatalf("发送消息: %v", err)
	}
	wantCalls := []string{
		"agent read wR:p1K --source recent-unwrapped --lines 3",
		"agent get wR:p1K",
		"pane run wR:p1K 继续完成演示",
	}
	if strings.Join(runner.calls, "\n") != strings.Join(wantCalls, "\n") {
		t.Fatalf("命令 = %#v", runner.calls)
	}
}

func TestReadAgentHistoryStripsTUIChrome(t *testing.T) {
	t.Parallel()

	rawText := strings.Join([]string{
		"* recap: shipped the LAN-only launch checklist.",
		"",
		strings.Repeat("─", 40),
		"❯",
		strings.Repeat("─", 40),
		"  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents" + strings.Repeat(" ", 20) + "912380 tokens",
		"globalVersion: 2.1.215 · latestVersion: 2.1.216",
	}, "\n")

	runner := &recordingRunner{outputs: map[string]string{
		"agent read term-ios --source recent-unwrapped --lines 40": rawText,
		"agent get term-ios": `{"result":{"type":"agent_info","agent":{"revision":9}}}`,
	}}
	adapter := herdrsource.NewHerdrCLIAdapter(runner)
	history, err := adapter.ReadAgentHistory(context.Background(), "term-ios", 40)
	if err != nil {
		t.Fatalf("read history: %v", err)
	}
	want := "* recap: shipped the LAN-only launch checklist."
	if history.Text != want {
		t.Fatalf("history.Text = %q, want %q", history.Text, want)
	}
}

func TestReadAgentHistoryPreservesShortMarkdownDivider(t *testing.T) {
	t.Parallel()

	runner := &recordingRunner{outputs: map[string]string{
		"agent read term-ios --source recent-unwrapped --lines 40": "a\n---\nb",
		"agent get term-ios": `{"result":{"type":"agent_info","agent":{"revision":1}}}`,
	}}
	adapter := herdrsource.NewHerdrCLIAdapter(runner)
	history, err := adapter.ReadAgentHistory(context.Background(), "term-ios", 40)
	if err != nil {
		t.Fatalf("read history: %v", err)
	}
	if history.Text != "a\n---\nb" {
		t.Fatalf("history.Text = %q, want short markdown divider preserved", history.Text)
	}
}

type stubRunner struct{ output []byte }

func (s stubRunner) Run(context.Context, string, ...string) ([]byte, error) { return s.output, nil }

type routingRunner struct{ outputs map[string]string }

func (r routingRunner) Run(_ context.Context, _ string, args ...string) ([]byte, error) {
	key := strings.Join(args, " ")
	output, ok := r.outputs[key]
	if !ok {
		return nil, fmt.Errorf("未配置命令 %q", key)
	}
	return []byte(output), nil
}

type recordingRunner struct {
	outputs map[string]string
	calls   []string
}

func (r *recordingRunner) Run(_ context.Context, _ string, args ...string) ([]byte, error) {
	key := strings.Join(args, " ")
	r.calls = append(r.calls, key)
	output, ok := r.outputs[key]
	if !ok {
		return nil, fmt.Errorf("未配置命令 %q", key)
	}
	return []byte(output), nil
}
