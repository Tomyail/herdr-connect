---
type: Domain Concept
title: Agent Projection & Persistence
description: Daemon-side agent state projection — snapshot vs incremental sync, normalization gated by source capabilities, transactional persistence to SQLite with lifecycle revisions and an outbox event log, plus cross-platform owner-only database permissions.
tags: [domain, projection, sqlite, state-management, persistence, permissions]
resource: /internal/projection
verified:
  - by: openwiki/0.4.3
    at: 2026-08-30T21:43:29.677Z
sources:
  - id: openwiki-source-435ef4d663e8147156c1b2dc
    resource: repo://internal/daemoncli/cli.go
  - id: openwiki-source-7bd743295a65ffe5a73f2ed4
    resource: repo://internal/demolan/auth.go
  - id: openwiki-source-07d77e7f317cf6efc47a9b12
    resource: repo://internal/demolan/rate_limit.go
  - id: openwiki-source-b3b42f4a3fbd26d2b780c8bf
    resource: repo://internal/demolan/snapshot_cache.go
  - id: openwiki-source-a187391f6fc7d39c1632329c
    resource: repo://internal/projection/projection_test.go
  - id: openwiki-source-c16ad2a32eb073622fc484b5
    resource: repo://internal/projection/projection.go
  - id: openwiki-source-ba429e1c8db84aa50c809255
    resource: repo://internal/store/permissions_unix_test.go
  - id: openwiki-source-be9465edbb574bf54f0188cf
    resource: repo://internal/store/permissions_unix.go
  - id: openwiki-source-e76dc777eb0d61a030b438de
    resource: repo://internal/store/permissions_windows_test.go
  - id: openwiki-source-9a5bccadf62b19e4347e50ea
    resource: repo://internal/store/permissions_windows.go
  - id: openwiki-source-4a81fcd95533ed8ba5a77739
    resource: repo://internal/store/store.go
generated: { by: "openwiki/0.4.3", at: "2026-08-30T21:43:29.677Z" }
---

# Agent Projection & Persistence

The projection layer (`/internal/projection/projection.go`) is the daemon's state core. It pulls observations from a [Herdr source](herdr-source-adapters.md), normalizes them under capability gating, and persists a projected agent state into SQLite via `/internal/store/store.go`. CLI commands (`status`, `agents`, `diagnostics`, `trace`, `daemon`) and the LAN server read the projected state; reads never require a live source because persistence is the source of truth between syncs.

## Responsibilities

1. **Snapshot sync** — `Projector.Sync` fetches a full `Snapshot` from the source (requiring the `observe_agents` capability), normalizes every observed agent, and applies one `ProjectionBatch` atomically.
2. **Incremental sync** — `Projector.ApplyChanges` fetches a `ChangeBatch` from a cursor (requiring `incremental_changes`), routing upserts and removals into the same batch mechanism.
3. **Normalization under capability gating** — `normalizeObservation` validates that each observation carries a stable `source_id` and a positive `revision`; if the source does not declare `trusted_interaction_state`, the state is downgraded to `unknown`; `turn_outcome` is only stored when `trusted_turn_outcome` is declared.
4. **Identity and lifecycle revisions** — On first observation the store assigns a fresh random ID `agent_<base32>` (16 random bytes). Every applied domain change increments a per-agent `lifecycle_revision`, independent of the source's own revision scheme.
5. **Cached reads** — `Projector.Current()` returns the last in-memory `State` (guarded by an `RWMutex`); `Load` rebuilds state from SQLite without contacting the source (used when the source is offline).

## Control flow

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: an unescaped angle bracket inside a label breaks rendering; rephrase the label. -->
```text
flowchart TD
    Src[herdrsource.Source] -->|Snapshot| Sync[Projector.Sync]
    Src -->|Changes cursor| AC[Projector.ApplyChanges]
    Sync --> Norm[normalizeObservation\ncapability-gated validation]
    AC --> Norm
    Norm --> Batch[store.ProjectionBatch\nupdates + removals + observed IDs + cursor]
    Batch --> APB[Store.ApplyProjectionBatch\nsingle SQLite transaction]
    APB --> SA[source_agents identity + revisions]
    APB --> CA[current_agents active projection]
    APB --> OB[outbox event + event_seq bump]
    APB --> SC[source_cursors cursor]
    APB --> Build[buildState -> in-memory State]
    Build --> Cur[Projector.Current]
```

## Persistence model

SQLite (`modernc.org/sqlite`, driver-pure-Go) is opened with `SetMaxOpenConns(1)`, WAL journaling, foreign keys on, and a 5 s busy timeout. `Open` runs migrations (current schema v2) in transactions keyed on `PRAGMA user_version`, refuses databases newer than the supported schema, and runs `PRAGMA quick_check` before accepting the file.

Tables relevant to projection:

- `source_agents` — stable identity: `(source_name, source_id)` primary key, unique `agent_id`, last `source_revision` and `lifecycle_revision`. Survives deactivation so an agent re-observed later keeps its `agent_id`.
- `current_agents` — the live projection, with an `active` flag; removal is deactivation, not deletion, and each deactivation also bumps `lifecycle_revision`.
- `source_cursors` — per-source resumption cursor for incremental sync.
- `outbox` + `installation_meta.event_seq` — every applied domain fact (upsert or removal) increments `event_seq` and appends a JSON payload event, giving clients a monotonic event stream (`ThroughEventSeq` in `State`).

`ApplyProjectionBatch` applies updates, removals, optional snapshot reconciliation, and the cursor write inside one transaction — a crashed daemon either sees the whole batch or none of it.

### Stale-write protection

`applyAgentTx` compares the incoming `source_revision` against the stored one:

- A stale or equal revision that changes no facts is a no-op (only `source_revision` may advance when facts are unchanged, and never downward).
- A stale delivery of an older revision cannot overwrite newer facts — ordering across out-of-order or replayed deliveries is preserved, so restarts and duplicate syncs never regress agent facts or the event sequence (asserted by `/internal/projection/projection_test.go`).
- Deactivations (`deactivateAgentTx`, snapshot reconciliation) are likewise ignored when the removal's revision is not strictly newer.

### Snapshot reconciliation

When `Sync` observes an online (authoritative) snapshot, `reconcileSnapshotTx` deactivates any active agent of that source absent from the observed set, using `stored_revision + 1` as the removal revision. Offline snapshots are not authoritative, so a temporarily unreachable source does not wipe the projection.

## Serving layer: snapshot cache, auth, rate limiting

The LAN server (`/internal/demolan`) wraps the source's `Snapshot` in a `cachedSnapshot` (`/internal/demolan/snapshot_cache.go`): a 1 s TTL cache with `singleflight` coalescing so the typical 1–3 s mobile polling cadence collapses into one underlying Herdr CLI invocation (each snapshot spawns 2+N subprocesses, bounded by a 5 s call timeout). Success, offline, and error results share the same TTL so transient failures are neither amplified nor masked; the wrapper deliberately exposes only `Snapshot` so the handler's capability type assertions (`AgentFocuser`, etc.) still reflect the real source.

Access is gated in front of all routes:

- **Client version gate** (`/internal/demolan/auth.go`) — `enforceClientVersion` runs before auth on every path (including `/v1/pair`): a request with `X-Herdr-Connect-Client-Version` below `MinSupportedClientVersion` (1) gets `426 client_outdated`; a missing header is allowed through for curl/manual probes.
- **Rate limiting** (`/internal/demolan/rate_limit.go`) — token buckets per device: reads 5 req/s burst 10, writes 1 req/s burst 3; plus per-IP 1 req/s burst 20 for `/v1/pair` and unauthenticated requests. Over-limit returns `429 rate_limited` with `Retry-After: 1`. The limiter is in-memory with no eviction (LAN-scale assumption).

Focused tests: `/internal/demolan/auth_test.go`, `/internal/demolan/rate_limit_test.go`, `/internal/demolan/sse_test.go`.

## Cross-platform database permissions

`store.Open` calls `prepareSecureDatabase` before opening and `secureSQLiteFiles` after migration so the database (and its `-wal`/`-shm` siblings) is owner-only on every platform:

- **Unix** (`/internal/store/permissions_unix.go`) — creates the parent directory `0700`, pre-creates the file with `0600` (with an explicit `Chmod`), and re-tightens `path`, `-wal`, `-shm` to `0600` after opening. Tested by `/internal/store/permissions_unix_test.go`, which asserts mode `0600` on the opened database.
- **Windows** (`/internal/store/permissions_windows.go`) — mode bits do not express access control, so a protected owner-only DACL (single ACE granting `GENERIC_ALL` to the current user's SID, `PROTECTED_DACL_SECURITY_INFORMATION` to drop inherited ACEs) is applied via `SetNamedSecurityInfo`. The file is first created without `SECURITY_ATTRIBUTES` and the DACL applied afterwards: any `SECURITY_DESCRIPTOR` built via `BuildSecurityDescriptor` carries `SE_SACL_PRESENT`, which would require the enabled `SeSecurityPrivilege` and fail with `ERROR_PRIVILEGE_NOT_HELD` for every normal user. `/internal/store/permissions_windows_test.go` asserts the DACL is protected with exactly one current-user ACE and that preparation is idempotent across daemon restarts.

`:memory:` databases skip both permission passes (used by tests).

## Tests

`/internal/projection/projection_test.go` drives the projector against a real SQLite file and the `herdrsource` fake source, covering: no-op duplicate syncs, out-of-order change delivery, restart on the same database (identity preserved, event seq not reset), capability gating of untrusted state/outcome, and snapshot reconciliation/removal behavior.
