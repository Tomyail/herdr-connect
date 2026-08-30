# Files

- [Agent Projection & Persistence](agent-projection.md) - Daemon-side agent state projection — snapshot vs incremental sync, normalization gated by source capabilities, transactional persistence to SQLite with lifecycle revisions and an outbox event log, plus cross-platform owner-only database permissions.
- [Herdr Source Adapters](herdr-source-adapters.md) - Source adapter interface that bridges Herdr CLI output (agent list, read, pane run/send-keys) to Herdr Connect domain model, addressing agents by pane_id
