package herdrsource

import "context"

type InteractionState string

const (
	InteractionWorking    InteractionState = "working"
	InteractionBlocked    InteractionState = "blocked"
	InteractionReadyInput InteractionState = "ready_input"
	InteractionUnknown    InteractionState = "unknown"
)

type TurnOutcome string

const (
	OutcomeSucceeded TurnOutcome = "succeeded"
	OutcomeFailed    TurnOutcome = "failed"
	OutcomeCancelled TurnOutcome = "cancelled"
)

type Capabilities struct {
	ObserveAgents           bool `json:"observe_agents"`
	IncrementalChanges      bool `json:"incremental_changes"`
	TrustedInteractionState bool `json:"trusted_interaction_state"`
	TrustedTurnOutcome      bool `json:"trusted_turn_outcome"`
	ReadOutput              bool `json:"read_output"`
	SendPrompt              bool `json:"send_prompt"`
	Interrupt               bool `json:"interrupt"`
}

type AgentObservation struct {
	SourceID         string           `json:"source_id"`
	DisplayName      string           `json:"display_name,omitempty"`
	WorkspaceLabel   string           `json:"workspace_label,omitempty"`
	TabLabel         string           `json:"tab_label,omitempty"`
	AgentName        string           `json:"agent_name,omitempty"`
	TurnID           string           `json:"turn_id,omitempty"`
	Revision         uint64           `json:"revision"`
	InteractionState InteractionState `json:"interaction_state"`
	TurnOutcome      *TurnOutcome     `json:"turn_outcome,omitempty"`
}

type Snapshot struct {
	Online bool               `json:"online"`
	Cursor string             `json:"cursor"`
	Agents []AgentObservation `json:"agents"`
}

type ChangeKind string

const (
	ChangeUpsert ChangeKind = "upsert"
	ChangeRemove ChangeKind = "remove"
)

type Change struct {
	Kind  ChangeKind       `json:"kind"`
	Agent AgentObservation `json:"agent"`
}

type ChangeBatch struct {
	AfterCursor string   `json:"after_cursor"`
	Changes     []Change `json:"changes"`
}

type Source interface {
	Name() string
	Snapshot(context.Context) (Snapshot, error)
	Changes(context.Context, string) (ChangeBatch, error)
	Capabilities(context.Context) (Capabilities, error)
}

// AgentFocuser 是演示阶段可选的最小控制能力，只允许切换 Herdr 的可见焦点。
type AgentFocuser interface {
	FocusAgent(context.Context, string) error
}

type AgentHistory struct {
	Text      string `json:"text"`
	Revision  uint64 `json:"revision"`
	Truncated bool   `json:"truncated"`
}

// AgentHistoryReader 读取范围受限的近期终端文本，仅用于受控演示。
type AgentHistoryReader interface {
	ReadAgentHistory(context.Context, string, int) (AgentHistory, error)
}

// AgentMessageSender 向已存在的 Agent pane 发送一条文本并提交 Enter。
type AgentMessageSender interface {
	SendAgentMessage(context.Context, string, string) error
}
