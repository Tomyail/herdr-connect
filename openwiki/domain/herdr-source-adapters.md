---
type: Domain Concept
title: Herdr Source Adapters
description: Source adapter interface that bridges Herdr CLI output to Herdr Connect domain model
tags: [domain, herdr-cli, source-adapter, interface-design]
resource: /internal/herdrsource
---

# Herdr Source Adapters

Herdr Source Adapters are the boundary layer that converts Herdr's native output into Herdr Connect's domain model. The daemon invokes Herdr CLI commands, parses JSON responses, and normalizes the results into a stable [Projection](../domain/agent-projection.md).

## Interface Design

The source interface (`/internal/herdrsource/source.go`) defines three core operations:

```go
type Source interface {
    Name() string
    Snapshot(context.Context) (Snapshot, error)
    Changes(context.Context, string) (ChangeBatch, error)
    Capabilities(context.Context) (Capabilities, error)
}
```

- **`Snapshot()`** — Returns the complete current state of all agents, used for initial sync
- **`Changes()`** — Returns incremental updates since a cursor, used for efficient updates
- **`Capabilities()`** — Declares which features the source supports (observations, changes, trusted state, etc.)

### Snapshot-Based vs. Incremental Sources

Sources can implement either snapshot-based or incremental synchronization:

- **Snapshot-only sources** — Always return the full agent list on `Snapshot()` and declare `IncrementalChanges: false`
- **Incremental sources** — Provide both `Snapshot()` and `Changes()`, declaring `IncrementalChanges: true`

The Herdr CLI adapter is currently snapshot-only. Each sync runs `herder agent list --json` and fetches all agents.

## Domain Types

### Agent Observation

An `AgentObservation` represents a single agent as reported by Herdr:

```go
type AgentObservation struct {
    SourceID         string           // Stable identifier from Herdr (e.g., pane ID)
    DisplayName      string           // Human-readable name
    WorkspaceLabel   string           // Optional workspace name
    TabLabel         string           // Optional tab name
    AgentName        string           // Optional agent type name
    TurnID           string           // Current turn/conversation ID
    Revision         uint64           // Monotonically increasing revision
    InteractionState InteractionState // working/blocked/ready_input/unknown
    TurnOutcome      *TurnOutcome     // Optional succeeded/failed/cancelled
}
```

The `SourceID` is the canonical identifier — all other fields are metadata. The projection layer uses `SourceID` to track lifecycle revisions.

### Interaction States

The adapter normalizes Herdr's interaction states into four values:

- `working` — Agent is actively processing
- `blocked` — Agent is waiting on external input or blocked
- `ready_input` — Agent is waiting for user text input
- `unknown` — State could not be determined

These map to status pills in the mobile client.

### Capabilities

Sources declare their supported features:

```go
type Capabilities struct {
    ObserveAgents           bool // Can list agents
    IncrementalChanges      bool // Can provide incremental updates
    TrustedInteractionState bool // State is authoritative (vs. inferred)
    TrustedTurnOutcome      bool // Outcome is authoritative
    ReadOutput              bool // Can read agent terminal output
    SendPrompt              bool // Can send text input
    Interrupt               bool // Can interrupt running agent
}
```

The Herdr CLI adapter declares `ObserveAgents: true`, `ReadOutput: true`, `SendPrompt: true`, and `Interrupt: true`. Other capabilities are `false` because the CLI does not expose them.

## Herdr CLI Adapter

The `HerdrCLIAdapter` (`/internal/herdrsource/herdr_cli.go`) implements the source interface by invoking Herdr commands:

### Snapshot Implementation

```go
func (h *HerdrCLIAdapter) Snapshot(ctx context.Context) (herdrsource.Snapshot, error) {
    // Run: herder agent list --json
    agents, online, err := h.fetchAgents(ctx)
    // Parse JSON response
    // Return Snapshot with Cursor set to current timestamp
}
```

The adapter:

1. Invokes `herder agent list --json` via `os/exec`
2. Parses the JSON response into `AgentObservation` structs
3. Sets `Cursor` to the current timestamp (ISO 8601 string)
4. Returns `Snapshot.Online = true` if the command succeeded

### History Reading

The adapter implements `AgentHistoryReader` for the demo LAN endpoints:

```go
func (h *HerdrCLIAdapter) ReadAgentHistory(ctx context.Context, sourceID string, lines int) (AgentHistory, error) {
    // Run: herder pane show --id <sourceID> --tail <lines>
    // Return truncated text and revision
}
```

This is called by the HTTP server when the mobile client requests `/v1/demo/agents/{id}/history`.

### Message Sending

The adapter implements `AgentMessageSender`:

```go
func (h *HerdrCLIAdapter) SendAgentMessage(ctx context.Context, sourceID string, text string) error {
    // Run: herder pane send --id <sourceID> --message <text>
}
```

This is called when the user sends text from the mobile client.

### Interrupt

The adapter implements `AgentInterrupter` to send SIGINT (Ctrl-C) to a running agent:

```go
func (h *HerdrCLIAdapter) Interrupt(ctx context.Context, sourceID string) error {
    // Run: herder pane interrupt --id <sourceID>
}
```

This is called when the user taps the interrupt button in the mobile client. The server only allows interrupt when the agent's interaction state is `working`.

## Fake Source

A fake source (`/internal/herdrsource/fake.go`) is provided for development and testing:

```go
source, err := herdrsource.NewFake("fake", capabilities, snapshot)
```

The fake source:

- Returns a fixed snapshot with configurable agents
- Supports incremental changes via a channel-based update mechanism
- Declares all capabilities as `true` for testing
- Does not invoke any external commands

Use `--source fake` in CLI commands for development without a live Herdr installation.

## Error Handling

Sources return errors for:

- **CLI execution failures** — Herdr binary not found, command failed, or JSON parse error
- **Timeouts** — Commands exceed context deadline
- **Invalid output** — Response does not match expected schema

The projection layer treats source errors as **soft failures** — it continues serving the last known state with `source_online: false` rather than failing completely.

## Cursor Semantics

Cursors are opaque strings that sources use for incremental change tracking:

- **Herdr CLI adapter** — Uses ISO 8601 timestamps (e.g., `2025-01-15T10:30:00Z`)
- **Future adapters** — May use tokens, offsets, or commit hashes

The projection layer passes the cursor from `Snapshot()` to `Changes()` on the next sync. If a source does not support incremental changes, `Changes()` returns an error.

## Extending to Other Sources

The source interface is designed to support future adapters beyond Herdr CLI:

### Potential Future Sources

- **Direct Herdr library** — Link against Herdr as a Go library (if Herdr exposes a library API)
- **WebSocket adapter** — Connect to Herdr's real-time event stream
- **Multi-Herdr adapter** — Aggregate multiple Herdr installations
- **Other agent systems** — Adapt non-Herdr agent frameworks

### Implementation Pattern

To add a new source:

1. Implement the `Source` interface in a new file under `/internal/herdrsource/`
2. Add a case to the source factory in `/cmd/herdr-connect/main.go`:

```go
case "my-source":
    return mysource.NewMySource(args), nil
```

3. Reference it via `--source my-source` in CLI commands

## Testing

Source behavior is tested via:

- **Unit tests** (`/internal/herdrsource/source_test.go`) — Test normalization and validation
- **Integration tests** — Test against a real Herdr CLI in CI
- **Fake source tests** — Test projection and HTTP layer without dependencies

See [Development Testing](../development/testing.md) for test practices.
