---
type: Domain Concept
title: Agent Projection Layer
description: Projection layer that normalizes source observations, persists state to SQLite, and exposes synchronized agent state
tags: [domain, projection, sqlite, state-management, persistence]
resource: /internal/projection
---

# Agent Projection Layer

The projection layer (`/internal/projection/projection.go`) is the state management core that normalizes [source observations](../domain/herdr-source-adapters.md), persists them to SQLite, and exposes a unified view to the HTTP server and CLI commands.

## Responsibilities

The projection layer:

1. **Normalizes source observations** — Converts Herdr CLI output into stable internal representations
2. **Tracks lifecycle revisions** — Monotonically increasing revision numbers per agent
3. **Detects removals** — Identifies agents that are no longer present in source snapshots
4. **Persists to SQLite** — Stores projected state with crash-safe writes
5. **Serves reads** — Returns current state without blocking on source sync

## Data Flow

```
Source Observation
        │
        ▼
  [Projection Layer]
        │
        ├─── Normalize to AgentRecord
        │     (assign AgentID, compute lifecycle revision)
        │
        ├─── Compare with existing records
        │     (detect upserts vs removals)
        │
        ├─── Apply ProjectionBatch to SQLite
        │     (atomic write with cursor)
        │
        └─── Build State for reads
              (aggregate from SQLite)
```

## Projection vs. Source

The projection layer introduces an indirection between source observations and stored state:

### Source Observation (Input)

- `SourceID` — Canonical identifier from Herdr
- `Revision` — Source-provided revision (may be absent or unstable)
- `InteractionState` — Current state (working/blocked/ready_input/unknown)

### Projected Agent (Stored)

- `AgentID` — Stable, internal identifier (UUID)
- `SourceID` — Copied from observation (foreign key)
- `LifecycleRevision` — Monotonically increasing internal revision
- `InteractionState` — Copied from observation
- `TurnOutcome` — Optional outcome (succeeded/failed/cancelled)

The projection layer assigns a stable `AgentID` on first observation and increments `LifecycleRevision` on every change. This decouples the projection from source-specific revision schemes.

## Normalization

The `normalizeObservation` function converts source observations to agent records:

```go
func normalizeObservation(caps herdrsource.Capabilities, obs herdrsource.AgentObservation) (store.AgentUpdate, error) {
    // 1. Validate required fields (SourceID, Revision)
    // 2. Compute stable AgentID from SourceID (hash-based)
    // 3. Determine LifecycleRevision (existing + 1 or 1 if new)
    // 4. Validate InteractionState if capabilities declare it trusted
    // 5. Return AgentUpdate with computed revision
}
```

### AgentID Derivation

`AgentID` is derived as a base32-encoded SHA-256 hash of `SourceID`:

```
AgentID = base32hex(hash(SourceID))[0:16].lowercase()
```

This ensures:

- **Determinism** — Same SourceID always produces same AgentID
- **Uniqueness** — Hash collision is astronomically unlikely
- **Stability** — AgentID survives source disconnections and reconnections

### Lifecycle Revision Tracking

The projection layer stores the current revision per agent in SQLite and increments it on each update:

```go
existing := store.GetAgent(sourceID)
lifecycleRevision := existing.LifecycleRevision + 1
```

This provides:

- **Change detection** — Client can compare revisions to detect updates
- **Ordering** — Higher revision always means later state
- **Idempotence** — Re-applying an old revision is a no-op

## Change Application

The projection layer applies batches of changes atomically:

```go
type ProjectionBatch struct {
    SourceName            string                // "herdr" or "fake"
    Cursor                string                // Source cursor for next sync
    Updates               []AgentUpdate         // Agents to upsert
    Removals              []AgentRemoval        // Agents to remove
    AuthoritativeSnapshot bool                  // true if source is online
    ObservedSourceIDs     map[string]struct{}   // All source IDs in this batch
}
```

### Upserts vs. Removals

- **Upsert** — Agent exists in current snapshot; update or insert
- **Removal** — Agent is absent but was previously observed; mark as removed

Removals are detected by comparing `ObservedSourceIDs` against previously stored agents. Agents not in the current snapshot but present in SQLite are removed with their final source revision.

### Authoritative Snapshot

When `AuthoritativeSnapshot = true`, the projection layer:

1. Applies all updates in the batch
2. Removes agents not in `ObservedSourceIDs`
3. Stores the cursor for next sync

When `false` (source offline), it:

1. Skips updates and removals
2. Serves last known state
3. Does not update the cursor

This allows the daemon to continue serving stale state when Herdr is temporarily unavailable.

## SQLite Schema

The projection layer uses two tables (`/internal/store/store.go`, schema v1):

### `agents` Table

```sql
CREATE TABLE agents (
    agent_id TEXT PRIMARY KEY,
    source_name TEXT NOT NULL,
    source_id TEXT NOT NULL,
    turn_id TEXT,
    lifecycle_revision INTEGER NOT NULL,
    interaction_state TEXT NOT NULL,
    turn_outcome TEXT,
    UNIQUE(source_name, source_id)
)
```

- `agent_id` — Stable internal identifier (primary key)
- `source_name` + `source_id` — Composite unique key for source lookups
- `lifecycle_revision` — Monotonically increasing per agent
- `interaction_state` — Normalized state string
- `turn_outcome` — Optional outcome string

### `projection_state` Table

```sql
CREATE TABLE projection_state (
    source_name TEXT PRIMARY KEY,
    cursor TEXT,
    last_sync_at TEXT,
    authoritative INTEGER NOT NULL DEFAULT 0
)
```

- `source_name` — "herdr" or "fake"
- `cursor` — Last cursor from source (timestamp, token, etc.)
- `last_sync_at` — ISO 8601 timestamp of last sync
- `authoritative` — Boolean: true if source was online on last sync

### Schema v2: Pairing Tables

Schema v2 migration adds `paired_devices` and `pairing_secrets` tables for the LAN [pairing](../protocol/secure-pairing.md) model. These tables are separate from the projection tables above and store per-device bearer token hashes and one-time pairing secrets. See the [Secure Pairing & TLS Protocol](../protocol/secure-pairing.md) page for details.

## Projection API

### Sync

```go
func (p *Projector) Sync(ctx context.Context, source herdrsource.Source) (State, error)
```

Fetches a fresh snapshot from the source, applies it to SQLite, and returns the new state. This is called periodically by the daemon loop.

### ApplyChanges

```go
func (p *Projector) ApplyChanges(ctx context.Context, source herdrsource.Source, cursor string) (State, error)
```

Fetches incremental changes since `cursor`, applies them, and returns the new state. Used for incremental sources (not yet implemented for Herdr CLI).

### Load

```go
func (p *Projector) Load(ctx context.Context, sourceName string, authoritative bool, caps herdrsource.Capabilities) (State, error)
```

Loads the last known state from SQLite without contacting the source. Used when the source is offline.

## Exposed State

The projection layer exposes a `State` struct to consumers:

```go
type State struct {
    SourceName      string                   // "herdr" or "fake"
    SourceOnline    bool                     // true if source was reachable on last sync
    Capabilities    herdrsource.Capabilities // What the source supports
    ThroughEventSeq uint64                   // Monotonic counter (reserved for protocol)
    Agents          []Agent                  // All agents in projection
}
```

### Projected Agent

```go
type Agent struct {
    AgentID           string                       // Internal stable ID
    SourceID          string                       // Herdr's ID
    TurnID            string                       // Current turn ID
    LifecycleRevision uint64                       // Internal revision
    InteractionState  herdrsource.InteractionState // working/blocked/etc.
    TurnOutcome       *herdrsource.TurnOutcome     // Optional outcome
}
```

## Error Handling

Projection errors fall into three categories:

### Soft Errors (Continue Serving)

- Source offline — Serve last known state with `SourceOnline = false`
- Partial sync failure — Retry on next sync without breaking existing state
- Individual agent validation failure — Skip that agent, log error

### Hard Errors (Fail Fast)

- SQLite corruption — Abort and require manual intervention
- Database migration failure — Cannot proceed without valid schema
- Context cancellation — Respect shutdown signals

### Validation Errors

- Missing required fields (`SourceID`, `Revision`) — Skip that agent
- Invalid interaction state — If source claims `TrustedInteractionState`, reject unknown values
- Revision decreased — Source sent old data; reject update

## Concurrency

The projection layer uses a mutex-protected in-memory cache:

```go
type Projector struct {
    store *store.Store
    mu    sync.RWMutex
    state State
}
```

- **Reads** — Acquire read lock, return cached state (no SQLite query)
- **Writes** — Acquire write lock, update SQLite and cache atomically
- **Sync operations** — Single-writer pattern; only one active sync at a time

The HTTP server and CLI commands read from the cached `State` without blocking on SQLite.

## Testing

Projection behavior is tested via:

- **Unit tests** (`/internal/projection/projection_test.go`) — Test normalization, batch application, lifecycle revision tracking
- **Integration tests** — Test full sync cycle with fake source
- **Store tests** (`/internal/store/store_test.go`) — Test SQLite operations, migrations

See [Development Testing](../development/testing.md) for test practices.
