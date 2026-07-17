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
	var response herdrAgentReadResponse
	if err := json.Unmarshal(output, &response); err != nil {
		return AgentHistory{}, fmt.Errorf("解析 Herdr agent.read JSON: %w", err)
	}
	if response.Result.Type != "pane_read" {
		return AgentHistory{}, fmt.Errorf("Herdr agent.read 返回非成功响应")
	}
	return AgentHistory{
		Text:      response.Result.Read.Text,
		Revision:  response.Result.Read.Revision,
		Truncated: response.Result.Read.Truncated,
	}, nil
}

func (a *HerdrCLIAdapter) SendAgentMessage(ctx context.Context, sourceID, text string) error {
	if sourceID == "" {
		return fmt.Errorf("Agent source_id 不能为空")
	}
	if strings.TrimSpace(text) == "" {
		return fmt.Errorf("消息不能为空")
	}

	output, err := a.runner.Run(ctx, a.binary, "agent", "get", sourceID)
	if err != nil {
		return fmt.Errorf("执行 Herdr agent.get: %w", err)
	}
	var response herdrAgentGetResponse
	if err := json.Unmarshal(output, &response); err != nil {
		return fmt.Errorf("解析 Herdr agent.get JSON: %w", err)
	}
	if response.Result.Type != "agent_info" || response.Result.Agent.PaneID == "" {
		return fmt.Errorf("Herdr agent.get 返回非成功响应")
	}
	if _, err := a.runner.Run(ctx, a.binary, "pane", "run", response.Result.Agent.PaneID, text); err != nil {
		return fmt.Errorf("执行 Herdr pane.run: %w", err)
	}
	return nil
}

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
			SourceID:         source.TerminalID,
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
	TerminalID  string `json:"terminal_id"`
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

type herdrAgentReadResponse struct {
	Result struct {
		Type string `json:"type"`
		Read struct {
			Text      string `json:"text"`
			Revision  uint64 `json:"revision"`
			Truncated bool   `json:"truncated"`
		} `json:"read"`
	} `json:"result"`
}

type herdrAgentGetResponse struct {
	Result struct {
		Type  string `json:"type"`
		Agent struct {
			PaneID string `json:"pane_id"`
		} `json:"agent"`
	} `json:"result"`
}
