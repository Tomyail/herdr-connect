---
type: Domain Concept
title: Herdr Source Adapters
description: Source adapter interface that bridges Herdr CLI output (agent list, read, pane run/send-keys) to Herdr Connect domain model, addressing agents by pane_id
tags: [domain, herdr-cli, source-adapter, interface-design]
resource: /internal/herdrsource
openwiki:
  roles: [domain, integration]
  change_kinds: [herdr-cli-shape, public-api]
  source_paths: [internal/herdrsource/herdr_cli.go, internal/herdrsource/source.go, internal/herdrsource/tui_chrome.go]
  symbols: [HerdrCLIAdapter, Source, Snapshot, ReadAgentHistory, SendAgentMessage, Interrupt, FocusAgent, AgentObservation]
  test_paths: [internal/herdrsource/source_test.go, internal/herdrsource/tui_chrome_test.go]
  invariants: >
    AgentObservation.SourceID is the agent's pane_id from `herdr agent list`;
    `herdr agent read` returns plain text on stdout (no JSON envelope) and
    revision is fetched separately via `herdr agent get`; SendAgentMessage and
    Interrupt pass sourceID straight to `pane run` / `pane send-keys C-c` with
    no agent-get indirection.
  validation_commands: ["go test ./internal/herdrsource/..."]
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

The Herdr CLI adapter is currently snapshot-only. Each sync runs `herdr agent list` and fetches all agents.

## Domain Types

### Agent Observation

An `AgentObservation` represents a single agent as reported by Herdr:

```go
type AgentObservation struct {
    SourceID         string           // Stable identifier from Herdr (the agent's pane_id — see Herdr CLI Adapter below)
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
    // Run: herdr agent list
    agents, online, err := h.fetchAgents(ctx)
    // Parse JSON response, set SourceID = pane_id per agent
    // Return Snapshot with Cursor set to the max observed revision
}
```

The adapter:

1. Invokes `herdr agent list` via `os/exec`
2. Parses the JSON response into `AgentObservation` structs, using each agent's **`pane_id`** as `SourceID`
3. Sets `Cursor` to the highest observed agent `revision` (as a decimal string)
4. Returns `Snapshot.Online = true` if the command succeeded

#### Why `pane_id`, not `terminal_id`

The `SourceID` is the agent's `pane_id` as reported by `herdr agent list`. An earlier version used `terminal_id`, which worked when the herdr CLI (0.7) accepted `terminal_id` for addressing in `agent get/read/focus`. As of herdr 0.8 those addressing commands only accept `pane_id`; a `terminal_id` resolves to `agent_not_found`, which surfaced as `502` on every detail-style REST endpoint (`focus`/`history`/`messages`/`interrupt`). Using `pane_id` for both addressing and display removes the extra `agent get` translation step that used to bridge the two IDs. See the `Snapshot` doc comment in `/internal/herdrsource/herdr_cli.go` for the historical rationale.

### History Reading

The adapter implements `AgentHistoryReader` for the demo LAN endpoints:

```go
func (h *HerdrCLIAdapter) ReadAgentHistory(ctx context.Context, sourceID string, lines int) (AgentHistory, error) {
    // Run: herdr agent read <sourceID> --source recent-unwrapped --lines <lines>
    // stdout is raw terminal TEXT (not JSON); revision comes from a separate
    // herdr agent get <sourceID> call.
    // Return stripped text, revision, and truncated flag.
}
```

This is called by the HTTP server when the mobile client requests `/v1/agents/{id}/history`.

**Important output-shape note:** `herdr agent read` (and the underlying `herdr pane read`) only support `--format text|ansi` and write the terminal text directly to stdout on success — there is **no JSON envelope**. Only failures (e.g., a missing target) write `{"error":...}` to stderr and exit non-zero, which `runner.Run` already converts into a Go error. An earlier version assumed the success response was `{"result":{"type":"pane_read",...}}` JSON, which never matched the real CLI and caused `json.Unmarshal` to fail → `history_failed` → `502` on every agent-detail view. Because `agent read` does not report a revision, the adapter makes one additional `herdr agent get <sourceID>` call (structured JSON) to fetch `revision`, keeping it consistent with `Snapshot()`. The `Truncated` flag is inferred by comparing the returned line count to the requested line count, since the CLI does not report truncation itself.

### TUI Chrome Stripping

Raw pane captures from `herdr agent read --source recent-unwrapped` include terminal UI decorations — input box borders, prompt glyphs, keyboard-hint legends, and status bars — that would clutter the mobile history view. The `stripTUIChrome` function (`/internal/herdrsource/tui_chrome.go`) removes these before returning the text.

The stripper works **backward from the last line**, peeling off contiguous chrome using vendor-agnostic structural classifiers:

- **Frame lines** — Lines dominated by Unicode box-drawing/block-element glyphs (U+2500–259F) or long ASCII rule lines (≥12 chars of `-`, `_`, `=`, `~`)
- **Box body rows** — Lines bounded by frame glyphs on both sides (Unicode-only, so markdown tables are never misclassified)
- **Bare prompt lines** — Single prompt glyphs (`❯`, `>`, `›`)
- **Legend lines** — Keyboard-hint rows requiring both a separator glyph (`│`, `·`, `•`) and keyboard vocabulary (`ctrl+`, `shift+`, `esc`, `tab:`, etc.)
- **Presumed status lines** (rescue, max 2) — Lines matching no classifier but sitting immediately below chrome (e.g., cwd or token-count bars)

ANSI escape sequences are stripped first; blank-line runs left by removed chrome are collapsed afterward. This design requires no per-agent configuration — the same classifiers work across Claude Code, Grok CLI, Pi/DeepSeek, and other agent CLIs.

### Message Sending

The adapter implements `AgentMessageSender`:

```go
func (h *HerdrCLIAdapter) SendAgentMessage(ctx context.Context, sourceID string, text string) error {
    // Run: herdr pane run <sourceID> <text>
}
```

This is called when the user sends text from the mobile client. Because `sourceID` is already the `pane_id` used in `Snapshot()`, it is passed straight to `pane run` with no `agent get` translation step.

### Interrupt

The adapter implements `AgentInterrupter` to send SIGINT (Ctrl-C) to a running agent:

```go
func (h *HerdrCLIAdapter) Interrupt(ctx context.Context, sourceID string) error {
    // Run: herdr pane send-keys <sourceID> C-c
}
```

This is called when the user taps the interrupt button in the mobile client. The server only allows interrupt when the agent's interaction state is `working`. As with `SendAgentMessage`, `sourceID` is the `pane_id` and is passed directly to `pane send-keys` with no `agent get` indirection.

The `Interrupt` doc comment records a verification caveat: `pane send-keys ... C-c` was confirmed end-to-end against a real running Herdr agent (whose foreground TUI reads keyboard input) but not against a bare backgrounded command like `sleep`, which may not surface the SIGINT. If a future agent type appears unresponsive to interrupt, suspect that agent's own SIGINT handling rather than this call chain.

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

- **Herdr CLI adapter** — Uses the highest agent `revision` observed in the snapshot, formatted as a decimal string via `strconv.FormatUint(maxRevision, 10)`. Because the adapter is snapshot-only and does not implement `Changes()`, the cursor is recorded with the projection but is not currently consumed for incremental sync.
- **Future adapters** — May use tokens, offsets, timestamps, or commit hashes

The projection layer passes the cursor from `Snapshot()` to `Changes()` on the next sync. If a source does not support incremental changes, `Changes()` returns an error (the Herdr CLI adapter returns its "no trusted incremental subscription" error).

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

- **Unit tests** (`/internal/herdrsource/source_test.go`) — Use a `recordingRunner` to assert exact `herdr` subcommand + argument shapes. Key suites: `Test当前Herdr适配器通过PaneID切换Agent` (`FocusAgent` → `agent focus <pane_id>`), `TestHerdrAdapterInterruptSendsControlCViaPaneSendKeys` (`Interrupt` → `pane send-keys <pane_id> C-c` with no `agent get`), and `Test当前Herdr适配器读取历史并通过Pane提交消息` (asserts `agent read` returns plain text, revision comes from a second `agent get`, and `SendAgentMessage` calls `pane run`). Fixtures use `pane_id` JSON fields and raw-text `agent read` stdout to mirror the real herdr 0.8 CLI.
- **TUI chrome tests** (`/internal/herdrsource/tui_chrome_test.go`) — Test stripping across multiple agent CLI fixtures (`testdata/pane-claude.txt`, `pane-grok.txt`, `pane-pi.txt`)
- **Fake source tests** — Test projection and HTTP layer without dependencies

Run the focused suite with `go test ./internal/herdrsource/...`. See [Development Testing](../development/testing.md) for test practices.
