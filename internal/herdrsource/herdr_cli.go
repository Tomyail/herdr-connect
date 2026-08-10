package herdrsource

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

type CommandRunner interface {
	Run(context.Context, string, ...string) ([]byte, error)
}

type ExecRunner struct{}

func (ExecRunner) Run(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).Output()
}

type HerdrCLIAdapter struct {
	runner CommandRunner
	binary string
}

func NewHerdrCLIAdapter(runner CommandRunner) *HerdrCLIAdapter {
	return NewHerdrCLIAdapterWithBinary(runner, "herdr")
}

func NewHerdrCLIAdapterWithBinary(runner CommandRunner, binary string) *HerdrCLIAdapter {
	return &HerdrCLIAdapter{runner: runner, binary: binary}
}

func (a *HerdrCLIAdapter) Name() string { return "herdr-cli-v0.7" }

func (a *HerdrCLIAdapter) Capabilities(context.Context) (Capabilities, error) {
	return Capabilities{ObserveAgents: true}, nil
}

func (a *HerdrCLIAdapter) Changes(context.Context, string) (ChangeBatch, error) {
	return ChangeBatch{}, fmt.Errorf("当前 Herdr 兼容适配器不提供可信增量订阅")
}

func (a *HerdrCLIAdapter) FocusAgent(ctx context.Context, sourceID string) error {
	if sourceID == "" {
		return fmt.Errorf("Agent source_id 不能为空")
	}
	if _, err := a.runner.Run(ctx, a.binary, "agent", "focus", sourceID); err != nil {
		return fmt.Errorf("执行 Herdr agent.focus: %w", err)
	}
	return nil
}

// ReadAgentHistory 读取 pane 最近文本。
//
// 注意：`herdr agent read`（以及底层的 `herdr pane read`）只支持
// `--format text|ansi`，成功时直接把终端文本写到 stdout——没有 JSON 包装；
// 只有失败（如 target 不存在）才会往 stderr 写 `{"error":...}` 并以非零码
// 退出，这种情况已经由 runner.Run 转成 Go error 处理。历史代码假设成功响应
// 也是形如 `{"result":{"type":"pane_read",...}}` 的 JSON，这在当前 CLI 上
// 从未成立，会导致 json.Unmarshal 直接失败 → history_failed → 502，这是
// mobile 端"agent 详情"全部 502 的直接原因。
//
// `read` 不回报 revision，所以额外调一次 `agent get <sourceID>`（结构化 JSON）
// 取 revision，和 Snapshot() 里的语义保持一致。
func (a *HerdrCLIAdapter) ReadAgentHistory(ctx context.Context, sourceID string, lines int) (AgentHistory, error) {
	if sourceID == "" {
		return AgentHistory{}, fmt.Errorf("Agent source_id 不能为空")
	}
	if lines < 1 || lines > 200 {
		return AgentHistory{}, fmt.Errorf("历史行数必须在 1 到 200 之间")
	}
	output, err := a.runner.Run(ctx, a.binary, "agent", "read", sourceID, "--source", "recent-unwrapped", "--lines", strconv.Itoa(lines))
	if err != nil {
		return AgentHistory{}, fmt.Errorf("执行 Herdr agent.read: %w", err)
	}
	revision, err := a.readAgentRevision(ctx, sourceID)
	if err != nil {
		return AgentHistory{}, fmt.Errorf("执行 Herdr agent.get: %w", err)
	}
	rawText := string(output)
	lineCount := len(strings.Split(strings.TrimRight(rawText, "\n"), "\n"))
	return AgentHistory{
		Text:      stripTUIChrome(rawText),
		Revision:  revision,
		Truncated: lineCount >= lines,
	}, nil
}

func (a *HerdrCLIAdapter) readAgentRevision(ctx context.Context, sourceID string) (uint64, error) {
	output, err := a.runner.Run(ctx, a.binary, "agent", "get", sourceID)
	if err != nil {
		return 0, fmt.Errorf("执行 Herdr agent.get: %w", err)
	}
	var response herdrAgentGetResponse
	if err := json.Unmarshal(output, &response); err != nil {
		return 0, fmt.Errorf("解析 Herdr agent.get JSON: %w", err)
	}
	if response.Result.Type != "agent_info" {
		return 0, fmt.Errorf("Herdr agent.get 返回非成功响应")
	}
	return response.Result.Agent.Revision, nil
}

// SendAgentMessage 直接把 sourceID 当 pane_id 传给 `pane run`——sourceID 就是
// Snapshot() 里用的 pane_id（见该函数注释），无需再 `agent get` 转换一次。
func (a *HerdrCLIAdapter) SendAgentMessage(ctx context.Context, sourceID, text string) error {
	if sourceID == "" {
		return fmt.Errorf("Agent source_id 不能为空")
	}
	if strings.TrimSpace(text) == "" {
		return fmt.Errorf("消息不能为空")
	}

	if _, err := a.runner.Run(ctx, a.binary, "pane", "run", sourceID, text); err != nil {
		return fmt.Errorf("执行 Herdr pane.run: %w", err)
	}
	return nil
}

// Interrupt 向指定 Agent 的 pane 发送中断信号（SIGINT / Ctrl-C）。
//
// 实现说明：sourceID 就是 pane_id（见 Snapshot 注释），直接用
// `pane send-keys <sourceID> C-c` 向该 pane 发送 Ctrl-C，无需先 `agent get`
// 转换。
//
// 验证记录：对着一个原始后台 `sleep` 子进程手测 send-keys 时未观察到 SIGINT
// 效果，一度怀疑 herdr CLI 不支持控制键。但在真机上对一个运行中的真实 Herdr
// agent（有前台 TUI 在读键盘输入，不是裸 shell 命令）实测 `POST .../interrupt`
// 端到端流程，agent 的当前 turn 确实被打断了——说明 send-keys 传递 C-c 本身是
// 有效的，之前的裸 sleep 测试只是不能代表真实场景（前台交互式进程会处理终端
// 信号，纯后台命令未必会）。如果后续遇到某些 agent 类型对 C-c 无响应，
// 优先怀疑是该 agent 自身对 SIGINT 的处理方式，而不是这条调用链路本身失效。
func (a *HerdrCLIAdapter) Interrupt(ctx context.Context, sourceID string) error {
	if sourceID == "" {
		return fmt.Errorf("Agent source_id 不能为空")
	}

	if _, err := a.runner.Run(ctx, a.binary, "pane", "send-keys", sourceID, "C-c"); err != nil {
		return fmt.Errorf("执行 Herdr pane.send-keys (interrupt): %w", err)
	}
	return nil
}

// Snapshot 用 pane_id 作为 AgentObservation.SourceID，而不是 terminal_id。
// 早期版本用 terminal_id：herdr CLI 0.7 时 `agent get/read/focus <target>`
// 接受 terminal_id 寻址；0.8 起这几个命令只认 pane_id，terminal_id 会报
// agent_not_found，导致详情类 REST 端点（focus/history/messages/interrupt）
// 全部 502。pane_id 由 `agent list` 直接给出，寻址和展示用同一个 ID，
// 不需要再额外一次 `agent get` 做转换。
func (a *HerdrCLIAdapter) Snapshot(ctx context.Context) (Snapshot, error) {
	output, err := a.runner.Run(ctx, a.binary, "agent", "list")
	if err != nil {
		return Snapshot{Online: false}, fmt.Errorf("执行 Herdr agent.list: %w", err)
	}
	var response herdrAgentListResponse
	if err := json.Unmarshal(output, &response); err != nil {
		return Snapshot{}, fmt.Errorf("解析 Herdr agent.list JSON: %w", err)
	}
	if response.Result.Type != "agent_list" {
		return Snapshot{}, fmt.Errorf("Herdr agent.list 返回非成功响应")
	}
	workspaceLabels, tabLabels := a.loadLocationLabels(ctx, response.Result.Agents)

	snapshot := Snapshot{Online: true, Agents: make([]AgentObservation, 0, len(response.Result.Agents))}
	var maxRevision uint64
	for _, source := range response.Result.Agents {
		workspaceLabel := workspaceLabels[source.WorkspaceID]
		tabLabel := tabLabels[source.TabID]
		displayName := agentDisplayName(source.Name, source.Agent, workspaceLabel, tabLabel)
		revision := source.Revision
		if revision == 0 {
			revision = 1
		}
		interactionState, turnOutcome := mapAgentStatus(source.AgentStatus)
		snapshot.Agents = append(snapshot.Agents, AgentObservation{
			SourceID:         source.PaneID,
			DisplayName:      displayName,
			WorkspaceLabel:   workspaceLabel,
			TabLabel:         tabLabel,
			AgentName:        source.Agent,
			Revision:         revision,
			InteractionState: interactionState,
			TurnOutcome:      turnOutcome,
		})
		if revision > maxRevision {
			maxRevision = revision
		}
	}
	snapshot.Cursor = strconv.FormatUint(maxRevision, 10)
	return snapshot, nil
}

func mapAgentStatus(status string) (InteractionState, *TurnOutcome) {
	switch strings.ToLower(status) {
	case "working":
		return InteractionWorking, nil
	case "blocked":
		return InteractionBlocked, nil
	case "idle":
		return InteractionReadyInput, nil
	case "done":
		return InteractionUnknown, outcomePointer(OutcomeSucceeded)
	case "failed":
		return InteractionUnknown, outcomePointer(OutcomeFailed)
	case "cancelled", "canceled":
		return InteractionUnknown, outcomePointer(OutcomeCancelled)
	default:
		return InteractionUnknown, nil
	}
}

func outcomePointer(outcome TurnOutcome) *TurnOutcome {
	return &outcome
}

func (a *HerdrCLIAdapter) loadLocationLabels(ctx context.Context, agents []herdrAgent) (map[string]string, map[string]string) {
	workspaceLabels := make(map[string]string)
	tabLabels := make(map[string]string)

	output, err := a.runner.Run(ctx, a.binary, "workspace", "list")
	if err != nil {
		return workspaceLabels, tabLabels
	}
	var workspaces herdrWorkspaceListResponse
	if json.Unmarshal(output, &workspaces) != nil || workspaces.Result.Type != "workspace_list" {
		return workspaceLabels, tabLabels
	}
	for _, workspace := range workspaces.Result.Workspaces {
		workspaceLabels[workspace.WorkspaceID] = workspace.Label
	}

	seen := make(map[string]bool)
	for _, agent := range agents {
		if agent.WorkspaceID == "" || seen[agent.WorkspaceID] {
			continue
		}
		seen[agent.WorkspaceID] = true
		output, err := a.runner.Run(ctx, a.binary, "tab", "list", "--workspace", agent.WorkspaceID)
		if err != nil {
			continue
		}
		var tabs herdrTabListResponse
		if json.Unmarshal(output, &tabs) != nil || tabs.Result.Type != "tab_list" {
			continue
		}
		for _, tab := range tabs.Result.Tabs {
			tabLabels[tab.TabID] = tab.Label
		}
	}
	return workspaceLabels, tabLabels
}

func agentDisplayName(fallback, agent, workspace, tab string) string {
	parts := make([]string, 0, 3)
	for _, value := range []string{workspace, tab, agent} {
		if value != "" {
			parts = append(parts, value)
		}
	}
	if len(parts) > 0 && (workspace != "" || tab != "") {
		return strings.Join(parts, " · ")
	}
	if fallback != "" {
		return fallback
	}
	return agent
}

type herdrAgent struct {
	PaneID      string `json:"pane_id"`
	Name        string `json:"name"`
	Agent       string `json:"agent"`
	AgentStatus string `json:"agent_status"`
	WorkspaceID string `json:"workspace_id"`
	TabID       string `json:"tab_id"`
	Revision    uint64 `json:"revision"`
}

type herdrAgentListResponse struct {
	Result struct {
		Type   string       `json:"type"`
		Agents []herdrAgent `json:"agents"`
	} `json:"result"`
}

type herdrWorkspaceListResponse struct {
	Result struct {
		Type       string `json:"type"`
		Workspaces []struct {
			WorkspaceID string `json:"workspace_id"`
			Label       string `json:"label"`
		} `json:"workspaces"`
	} `json:"result"`
}

type herdrTabListResponse struct {
	Result struct {
		Type string `json:"type"`
		Tabs []struct {
			TabID string `json:"tab_id"`
			Label string `json:"label"`
		} `json:"tabs"`
	} `json:"result"`
}

type herdrAgentGetResponse struct {
	Result struct {
		Type  string     `json:"type"`
		Agent herdrAgent `json:"agent"`
	} `json:"result"`
}
