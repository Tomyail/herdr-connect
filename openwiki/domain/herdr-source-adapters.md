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
verified:
  - by: openwiki/0.4.3
    at: 2026-08-30T21:43:29.677Z
sources:
  - id: openwiki-source-25242df1a4c24e52950d179b
    resource: repo://internal/herdrsource/fake.go
  - id: openwiki-source-534192c6054468f4777cf5f9
    resource: repo://internal/herdrsource/herdr_cli.go
  - id: openwiki-source-e47dbc06009d980d4242d8be
    resource: repo://internal/herdrsource/source_test.go
  - id: openwiki-source-81f157535de75893a2391d71
    resource: repo://internal/herdrsource/source.go
  - id: openwiki-source-92b2d50b2ed9be1154171648
    resource: repo://internal/herdrsource/tui_chrome.go
generated: { by: "openwiki/0.4.3", at: "2026-08-30T21:43:29.677Z" }
---

# Herdr Source Adapters

Herdr Source Adapters are the boundary layer that converts Herdr's native CLI output into Herdr Connect's domain model. The daemon shells out to the `herdr` binary, parses JSON (or raw text) responses, and normalizes the results into a stable [Projection](../domain/agent-projection.md).

## Interface Design

The source interface (`internal/herdrsource/source.go`) defines three core operations:

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

Four optional control interfaces extend the minimal `Source`:

- **`AgentFocuser.FocusAgent`** — switch Herdr's visible focus to an agent pane
- **`AgentHistoryReader.ReadAgentHistory`** — read a bounded window of recent terminal text (1–200 lines)
- **`AgentMessageSender.SendAgentMessage`** — send one line of text plus Enter to an agent pane
- **`AgentInterrupter.Interrupt`** — send SIGINT/Ctrl-C to stop the agent's current turn

Callers (daemon handlers) type-assert these optional interfaces based on the capability flags rather than assuming every `Source` supports them.

### Snapshot-Based vs. Incremental Sources

Sources can implement either snapshot-based or incremental synchronization:

- **Snapshot-only sources** — Always return the full agent list on `Snapshot()` and declare `IncrementalChanges: false`
- **Incremental sources** — Provide both `Snapshot()` and `Changes()`, declaring `IncrementalChanges: true`

The Herdr CLI adapter is currently snapshot-only: its `Changes()` returns an error ("当前 Herdr 兼容适配器不提供可信增量订阅") and its `Capabilities()` returns only `ObserveAgents: true`. The test suite asserts this deliberately conservative capability matrix.

## Domain Types

### Agent Observation

An `AgentObservation` represents a single agent as reported by Herdr:

```go
type AgentObservation struct {
    SourceID         string           // Stable identifier from Herdr (the agent's pane_id)
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

### Interaction States and Turn Outcomes

The adapter normalizes Herdr's `agent_status` string via `mapAgentStatus`:

| Herdr status | InteractionState | TurnOutcome |
|---|---|---|
| `working` | `working` | nil |
| `blocked` | `blocked` | nil |
| `idle` | `ready_input` | nil |
| `done` | `unknown` | `succeeded` |
| `failed` | `unknown` | `failed` |
| `cancelled`/`canceled` | `unknown` | `cancelled` |
| anything else | `unknown` | nil |

These map to status pills in the mobile client. Because the adapter does not declare `TrustedInteractionState` or `TrustedTurnOutcome`, the downstream projection treats these values as advisory rather than authoritative.

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

## HerdrCLIAdapter

`HerdrCLIAdapter` (`internal/herdrsource/herdr_cli.go`) is the production implementation. It runs the CLI through an injected `CommandRunner` (`Run(ctx, name, args...) ([]byte, error)`); the default `ExecRunner` uses `exec.CommandContext(...).Output()`. `NewHerdrCLIAdapter` defaults the binary name to `herdr`, while `NewHerdrCLIAdapterWithBinary` allows overriding it — both constructors exist mainly so tests can inject a stub runner.

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: an unescaped angle bracket inside a label breaks rendering; rephrase the label. -->
```text
sequenceDiagram
    participant D as Daemon handler
    participant A as HerdrCLIAdapter
    participant R as CommandRunner
    participant H as herdr CLI
    D->>A: Snapshot(ctx)
    A->>R: Run("herdr", "agent", "list")
    R->>H: exec
    H-->>R: {"result":{"type":"agent_list",...}}
    A->>R: Run("herdr", "workspace", "list")
    A->>R: Run("herdr", "tab", "list", "--workspace", <id>) (per workspace)
    A-->>D: Snapshot{Online, Agents[], Cursor=maxRevision}
```

### Snapshot: pane_id addressing

`Snapshot()` runs `herdr agent list` and uses the returned `pane_id` as `AgentObservation.SourceID` — not the terminal_id. This is a load-bearing invariant: Herdr CLI 0.7 accepted terminal_id for `agent get/read/focus`, but 0.8+ only accepts pane_id, and terminal_id addressing fails with `agent_not_found` (surfacing as 502s from the focus/history/messages/interrupt REST endpoints). Since `agent list` returns pane_id directly, addressing and display share one ID with no extra `agent get` translation.

Additional snapshot behaviors:

- A zero revision from the CLI is coerced to `1` so the projection always has a positive revision.
- The snapshot `Cursor` is the maximum revision across agents (formatted as a decimal string).
- Workspace/tab labels are enriched via `herdr workspace list` plus one `herdr tab list --workspace <id>` per distinct workspace. These enrichment calls fail soft — on any error the snapshot still succeeds with empty labels.
- Display names are composed as `workspace · tab · agent` when location labels exist, falling back to the CLI-provided name, then the agent type name.
- A CLI execution error yields `Snapshot{Online: false}` plus the error, so callers can distinguish "herdr unreachable" from an empty agent list; JSON unmarshal failure or a non-`agent_list` result type yields a hard error.

### ReadAgentHistory: plain text, no JSON envelope

`ReadAgentHistory(ctx, sourceID, lines)` validates the sourceID is non-empty and the line count is within 1–200, then runs `herdr agent read <sourceID> --source recent-unwrapped --lines N`. Critically, `agent read` (and the underlying `pane read`) writes raw terminal text straight to stdout on success — there is **no JSON envelope**. Only failures write `{"error":...}` to stderr with a non-zero exit, which the runner converts to a Go error. An earlier implementation that tried to unmarshal a `{"result":{"type":"pane_read",...}}` envelope always failed to parse, causing `history_failed` and universal 502s on the mobile agent-detail view.

Because `read` does not report a revision, the adapter makes a second call, `herdr agent get <sourceID>` (which does return structured JSON with `result.type == "agent_info"`), to fetch the revision — keeping semantics consistent with `Snapshot()`. The returned `AgentHistory` contains the TUI-chrome-stripped text, that revision, and a `Truncated` flag set when the returned line count meets the requested `lines`.

### SendAgentMessage and Interrupt: direct pane addressing

`SendAgentMessage(ctx, sourceID, text)` validates that both sourceID and the trimmed text are non-empty, then runs `herdr pane run <sourceID> <text>` — passing the sourceID directly as the pane_id with no `agent get` indirection. `Interrupt(ctx, sourceID)` runs `herdr pane send-keys <sourceID> C-c`. Field verification recorded in the code: sending C-c does interrupt a real running agent TUI end-to-end, though a bare background process like `sleep` may not visibly react since only foreground interactive processes handle terminal signals — so if a particular agent type ignores C-c, suspect the agent's own SIGINT handling rather than this call path.

## TUI Chrome Stripping

`stripTUIChrome` (`internal/herdrsource/tui_chrome.go`) removes input-box borders, keyboard-hint footers, and bare prompt lines from the raw pane capture before it is returned as agent history. Every coding-agent CLI pins its chrome to the bottom of the screen, so the stripper walks backward from the end and peels off lines that look like chrome, stopping at the first non-chrome line. Classification is structural rather than vendor-specific, so no per-agent rules are needed:

- **Frame lines** — lines dominated (≥ 70% of non-space runes) by box-drawing/block glyphs, or an ASCII rule line of at least 12 trimmed characters (a floor that keeps markdown `---` dividers from being eaten).
- **Legend lines** — keyboard-hint vocabulary (`ctrl+`, `shift+`, `esc`, `shortcuts`, arrow keys, `tab:`/`enter:`/`space:` prefixes), separated by Unicode `· • │` (deliberately not the ASCII pipe, too common in markdown tables).
- **Bare prompt lines** — a lone `❯ > ›` character.
- **ANSI escapes** are stripped first and CRLF normalized to LF.

Two guards keep the heuristic safe: at most 2 otherwise-unclassifiable short lines (≤ 200 runes) may be "rescued" as presumed status lines per capture, so long runs of short prose can never cascade into deleted content; and trailing blank lines are collapsed. `internal/herdrsource/tui_chrome_test.go` covers these cases.

## Fakes and Tests

`Fake` (`internal/herdrsource/fake.go`) is a mutex-protected in-memory `Source` used elsewhere for daemon-level tests. It applies appended `ChangeBatch`es to its snapshot (upsert-by-SourceID or remove), advances the cursor, and serves `Changes(cursor)` only for known cursors — an unavailable cursor is an error. It can advertise any capability matrix, including the fully-featured one the real adapter does not yet support.

`internal/herdrsource/source_test.go` pins two behaviors: the `Fake` lifecycle/capability round-trip, and the real adapter's mapping against the fixture `testdata/herdr-v0.7-agent-list.json` — asserting `SourceID == "pane-1"`, revision coercion, `unknown` + `OutcomeSucceeded` status mapping, and the conservative capability matrix (`ObserveAgents` only). Validate with `go test ./internal/herdrsource/...`.
