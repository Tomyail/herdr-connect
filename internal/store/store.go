package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base32"
	"encoding/json"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

const currentSchemaVersion = 1

type Store struct {
	db            *sql.DB
	schemaVersion int
}

type AgentRecord struct {
	AgentID           string  `json:"agent_id"`
	SourceName        string  `json:"source_name"`
	SourceID          string  `json:"source_id"`
	TurnID            string  `json:"turn_id,omitempty"`
	LifecycleRevision uint64  `json:"lifecycle_revision"`
	InteractionState  string  `json:"interaction_state"`
	TurnOutcome       *string `json:"turn_outcome,omitempty"`
}

type AgentUpdate struct {
	SourceRevision uint64
	Record         AgentRecord
}

type AgentRemoval struct {
	SourceID       string
	SourceRevision uint64
}

type ProjectionBatch struct {
	SourceName            string
	Cursor                string
	Updates               []AgentUpdate
	Removals              []AgentRemoval
	AuthoritativeSnapshot bool
	ObservedSourceIDs     map[string]struct{}
}

func Open(ctx context.Context, path string) (*Store, error) {
	if path == "" {
		return nil, fmt.Errorf("数据库路径不能为空")
	}
	if path != ":memory:" {
		if err := prepareSecureDatabase(path); err != nil {
			return nil, err
		}
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("打开 SQLite: %w", err)
	}
	db.SetMaxOpenConns(1)
	result := &Store{db: db}
	if err := result.migrate(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := result.quickCheck(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	if path != ":memory:" {
		if err := secureSQLiteFiles(path); err != nil {
			_ = db.Close()
			return nil, err
		}
	}
	return result, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) SchemaVersion() int { return s.schemaVersion }

func (s *Store) quickCheck(ctx context.Context) error {
	var result string
	if err := s.db.QueryRowContext(ctx, `PRAGMA quick_check(1)`).Scan(&result); err != nil {
		return fmt.Errorf("执行 SQLite quick_check: %w", err)
	}
	if result != "ok" {
		return fmt.Errorf("SQLite quick_check 失败: %s", result)
	}
	return nil
}

func (s *Store) migrate(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, `PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;`); err != nil {
		return fmt.Errorf("配置 SQLite: %w", err)
	}
	if err := s.db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&s.schemaVersion); err != nil {
		return fmt.Errorf("读取 schema version: %w", err)
	}
	if s.schemaVersion > currentSchemaVersion {
		return fmt.Errorf("数据库 schema v%d 高于当前支持的 v%d", s.schemaVersion, currentSchemaVersion)
	}
	if s.schemaVersion == currentSchemaVersion {
		return nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("开始迁移事务: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, migrationV1); err != nil {
		return fmt.Errorf("执行 schema v1 迁移: %w", err)
	}
	if err := tx.QueryRowContext(ctx, "PRAGMA user_version").Scan(&s.schemaVersion); err != nil {
		return fmt.Errorf("读取 schema version: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("提交迁移: %w", err)
	}
	return nil
}

func (s *Store) CurrentEventSeq(ctx context.Context) (uint64, error) {
	var seq uint64
	if err := s.db.QueryRowContext(ctx, `SELECT event_seq FROM installation_meta WHERE singleton = 1`).Scan(&seq); err != nil {
		return 0, fmt.Errorf("读取 event_seq: %w", err)
	}
	return seq, nil
}

func (s *Store) SourceCursor(ctx context.Context, sourceName string) (string, error) {
	var cursor string
	err := s.db.QueryRowContext(ctx, `SELECT cursor FROM source_cursors WHERE source_name = ?`, sourceName).Scan(&cursor)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("读取 Herdr Source cursor: %w", err)
	}
	return cursor, nil
}

func (s *Store) ApplyProjectionBatch(ctx context.Context, batch ProjectionBatch) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("开始来源投影批次: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	for _, update := range batch.Updates {
		if _, _, err := applyAgentTx(ctx, tx, batch.SourceName, update.SourceRevision, update.Record); err != nil {
			return err
		}
	}
	for _, removal := range batch.Removals {
		if _, err := deactivateAgentTx(ctx, tx, batch.SourceName, removal.SourceID, removal.SourceRevision); err != nil {
			return err
		}
	}
	if batch.AuthoritativeSnapshot {
		if err := reconcileSnapshotTx(ctx, tx, batch.SourceName, batch.ObservedSourceIDs); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `
INSERT INTO source_cursors(source_name, cursor) VALUES (?, ?)
ON CONFLICT(source_name) DO UPDATE SET cursor = excluded.cursor`, batch.SourceName, batch.Cursor); err != nil {
		return fmt.Errorf("保存 Herdr Source cursor: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("提交来源投影批次: %w", err)
	}
	return nil
}

func applyAgentTx(ctx context.Context, tx *sql.Tx, sourceName string, sourceRevision uint64, record AgentRecord) (AgentRecord, bool, error) {
	var previousSourceRevision uint64
	var lifecycleRevision uint64
	var active bool
	err := tx.QueryRowContext(ctx, `
SELECT sa.agent_id, sa.source_revision, sa.lifecycle_revision, COALESCE(ca.active, 0)
FROM source_agents sa LEFT JOIN current_agents ca ON ca.agent_id = sa.agent_id
WHERE sa.source_name = ? AND sa.source_id = ?`, sourceName, record.SourceID).
		Scan(&record.AgentID, &previousSourceRevision, &lifecycleRevision, &active)
	switch {
	case err == sql.ErrNoRows:
		record.AgentID, err = newID("agent")
		if err != nil {
			return AgentRecord{}, false, err
		}
		record.LifecycleRevision = 1
		if _, err := tx.ExecContext(ctx, `
INSERT INTO source_agents(source_name, source_id, agent_id, source_revision, lifecycle_revision)
VALUES (?, ?, ?, ?, ?)`, sourceName, record.SourceID, record.AgentID, sourceRevision, record.LifecycleRevision); err != nil {
			return AgentRecord{}, false, fmt.Errorf("保存 Agent 来源身份: %w", err)
		}
	case err != nil:
		return AgentRecord{}, false, fmt.Errorf("读取 Agent 来源身份: %w", err)
	case !active && sourceRevision <= previousSourceRevision:
		return AgentRecord{}, false, nil
	case active && sourceRevision <= previousSourceRevision:
		current, err := scanAgent(tx.QueryRowContext(ctx, `
SELECT agent_id, source_name, source_id, COALESCE(turn_id, ''), lifecycle_revision,
       interaction_state, turn_outcome
FROM current_agents WHERE agent_id = ? AND active = 1`, record.AgentID))
		if err != nil {
			return AgentRecord{}, false, fmt.Errorf("读取当前 Agent 投影: %w", err)
		}
		return current, false, nil
	case active:
		current, err := scanAgent(tx.QueryRowContext(ctx, `
SELECT agent_id, source_name, source_id, COALESCE(turn_id, ''), lifecycle_revision,
       interaction_state, turn_outcome
FROM current_agents WHERE agent_id = ? AND active = 1`, record.AgentID))
		if err != nil {
			return AgentRecord{}, false, fmt.Errorf("读取当前 Agent 投影: %w", err)
		}
		record.SourceName = sourceName
		if sameFacts(current, record) {
			if _, err := tx.ExecContext(ctx, `
UPDATE source_agents SET source_revision = ? WHERE source_name = ? AND source_id = ?`, sourceRevision, sourceName, record.SourceID); err != nil {
				return AgentRecord{}, false, fmt.Errorf("更新无领域变化的来源 revision: %w", err)
			}
			return current, false, nil
		}
		record.LifecycleRevision = lifecycleRevision + 1
		if _, err := tx.ExecContext(ctx, `
UPDATE source_agents SET source_revision = ?, lifecycle_revision = ?
WHERE source_name = ? AND source_id = ?`, sourceRevision, record.LifecycleRevision, sourceName, record.SourceID); err != nil {
			return AgentRecord{}, false, fmt.Errorf("更新 Agent 来源 revision: %w", err)
		}
	default:
		record.LifecycleRevision = lifecycleRevision + 1
		if sourceRevision < previousSourceRevision {
			sourceRevision = previousSourceRevision
		}
		if _, err := tx.ExecContext(ctx, `
UPDATE source_agents SET source_revision = ?, lifecycle_revision = ?
WHERE source_name = ? AND source_id = ?`, sourceRevision, record.LifecycleRevision, sourceName, record.SourceID); err != nil {
			return AgentRecord{}, false, fmt.Errorf("更新 Agent 来源 revision: %w", err)
		}
	}

	record.SourceName = sourceName
	if _, err := tx.ExecContext(ctx, `
INSERT INTO current_agents(agent_id, source_name, source_id, turn_id, lifecycle_revision, interaction_state, turn_outcome, active)
VALUES (?, ?, ?, ?, ?, ?, ?, 1)
ON CONFLICT(agent_id) DO UPDATE SET
  turn_id = excluded.turn_id,
  lifecycle_revision = excluded.lifecycle_revision,
  interaction_state = excluded.interaction_state,
  turn_outcome = excluded.turn_outcome,
  active = 1`, record.AgentID, sourceName, record.SourceID, nullable(record.TurnID), record.LifecycleRevision, record.InteractionState, record.TurnOutcome); err != nil {
		return AgentRecord{}, false, fmt.Errorf("保存当前 Agent 投影: %w", err)
	}
	if _, err := appendEvent(ctx, tx, record); err != nil {
		return AgentRecord{}, false, err
	}
	return record, true, nil
}

func reconcileSnapshotTx(ctx context.Context, tx *sql.Tx, sourceName string, observed map[string]struct{}) error {
	rows, err := tx.QueryContext(ctx, `
SELECT sa.source_id, sa.source_revision
FROM source_agents sa JOIN current_agents ca ON ca.agent_id = sa.agent_id
WHERE sa.source_name = ? AND ca.active = 1`, sourceName)
	if err != nil {
		return fmt.Errorf("读取快照外 Agent: %w", err)
	}
	type missingAgent struct {
		sourceID string
		revision uint64
	}
	var missing []missingAgent
	for rows.Next() {
		var candidate missingAgent
		if err := rows.Scan(&candidate.sourceID, &candidate.revision); err != nil {
			_ = rows.Close()
			return fmt.Errorf("解析快照外 Agent: %w", err)
		}
		if _, ok := observed[candidate.sourceID]; !ok {
			missing = append(missing, candidate)
		}
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("关闭快照 reconciliation 查询: %w", err)
	}
	for _, candidate := range missing {
		if _, err := deactivateAgentTx(ctx, tx, sourceName, candidate.sourceID, candidate.revision+1); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) ActiveAgents(ctx context.Context) ([]AgentRecord, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT agent_id, source_name, source_id, COALESCE(turn_id, ''), lifecycle_revision,
       interaction_state, turn_outcome
FROM current_agents WHERE active = 1 ORDER BY agent_id`)
	if err != nil {
		return nil, fmt.Errorf("读取 Agent 投影: %w", err)
	}
	defer rows.Close()
	var agents []AgentRecord
	for rows.Next() {
		agent, err := scanAgent(rows)
		if err != nil {
			return nil, fmt.Errorf("解析 Agent 投影: %w", err)
		}
		agents = append(agents, agent)
	}
	return agents, rows.Err()
}

func deactivateAgentTx(ctx context.Context, tx *sql.Tx, sourceName, sourceID string, sourceRevision uint64) (bool, error) {
	var record AgentRecord
	var previousSourceRevision uint64
	var outcome sql.NullString
	err := tx.QueryRowContext(ctx, `
SELECT sa.agent_id, sa.source_revision, sa.lifecycle_revision,
       COALESCE(ca.turn_id, ''), ca.interaction_state, ca.turn_outcome
FROM source_agents sa JOIN current_agents ca ON ca.agent_id = sa.agent_id
WHERE sa.source_name = ? AND sa.source_id = ? AND ca.active = 1`, sourceName, sourceID).
		Scan(&record.AgentID, &previousSourceRevision, &record.LifecycleRevision,
			&record.TurnID, &record.InteractionState, &outcome)
	if err == sql.ErrNoRows || sourceRevision <= previousSourceRevision {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("读取待关闭 Agent: %w", err)
	}
	record.SourceName = sourceName
	record.SourceID = sourceID
	record.LifecycleRevision++
	if outcome.Valid {
		record.TurnOutcome = &outcome.String
	}
	if _, err := tx.ExecContext(ctx, `
UPDATE source_agents SET source_revision = ?, lifecycle_revision = ?
WHERE source_name = ? AND source_id = ?`, sourceRevision, record.LifecycleRevision, sourceName, sourceID); err != nil {
		return false, fmt.Errorf("更新已关闭 Agent revision: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE current_agents SET active = 0, lifecycle_revision = ? WHERE agent_id = ?`, record.LifecycleRevision, record.AgentID); err != nil {
		return false, fmt.Errorf("关闭 Agent 投影: %w", err)
	}
	if _, err := appendEvent(ctx, tx, record); err != nil {
		return false, err
	}
	return true, nil
}

type rowScanner interface{ Scan(...any) error }

func scanAgent(row rowScanner) (AgentRecord, error) {
	var record AgentRecord
	var outcome sql.NullString
	err := row.Scan(&record.AgentID, &record.SourceName, &record.SourceID, &record.TurnID,
		&record.LifecycleRevision, &record.InteractionState, &outcome)
	if outcome.Valid {
		record.TurnOutcome = &outcome.String
	}
	return record, err
}

func appendEvent(ctx context.Context, tx *sql.Tx, record AgentRecord) (uint64, error) {
	if _, err := tx.ExecContext(ctx, `UPDATE installation_meta SET event_seq = event_seq + 1 WHERE singleton = 1`); err != nil {
		return 0, fmt.Errorf("递增 event_seq: %w", err)
	}
	var seq uint64
	if err := tx.QueryRowContext(ctx, `SELECT event_seq FROM installation_meta WHERE singleton = 1`).Scan(&seq); err != nil {
		return 0, fmt.Errorf("读取 event_seq: %w", err)
	}
	eventID, err := newID("evt")
	if err != nil {
		return 0, err
	}
	payload, err := json.Marshal(record)
	if err != nil {
		return 0, fmt.Errorf("编码生命周期事实: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
INSERT INTO outbox(event_id, event_seq, payload, created_at_ms) VALUES (?, ?, ?, ?)`,
		eventID, seq, payload, time.Now().UnixMilli()); err != nil {
		return 0, fmt.Errorf("写入 outbox: %w", err)
	}
	return seq, nil
}

func newID(prefix string) (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("生成 %s ID: %w", prefix, err)
	}
	return prefix + "_" + base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw), nil
}

func nullable(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func sameFacts(left, right AgentRecord) bool {
	if left.TurnID != right.TurnID || left.InteractionState != right.InteractionState {
		return false
	}
	if left.TurnOutcome == nil || right.TurnOutcome == nil {
		return left.TurnOutcome == nil && right.TurnOutcome == nil
	}
	return *left.TurnOutcome == *right.TurnOutcome
}

const migrationV1 = `
CREATE TABLE IF NOT EXISTS installation_meta (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    event_seq INTEGER NOT NULL DEFAULT 0 CHECK (event_seq >= 0)
);
INSERT OR IGNORE INTO installation_meta(singleton, event_seq) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS source_cursors (
    source_name TEXT PRIMARY KEY,
    cursor TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_agents (
    source_name TEXT NOT NULL,
    source_id TEXT NOT NULL,
    agent_id TEXT NOT NULL UNIQUE,
    source_revision INTEGER NOT NULL DEFAULT 0,
    lifecycle_revision INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(source_name, source_id)
);

CREATE TABLE IF NOT EXISTS current_agents (
    agent_id TEXT PRIMARY KEY REFERENCES source_agents(agent_id),
    source_name TEXT NOT NULL,
    source_id TEXT NOT NULL,
    turn_id TEXT,
    lifecycle_revision INTEGER NOT NULL,
    interaction_state TEXT NOT NULL CHECK (interaction_state IN ('working', 'blocked', 'ready_input', 'unknown')),
    turn_outcome TEXT CHECK (turn_outcome IS NULL OR turn_outcome IN ('succeeded', 'failed', 'cancelled')),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS outbox (
    event_id TEXT PRIMARY KEY,
    event_seq INTEGER NOT NULL UNIQUE,
    payload BLOB NOT NULL,
    created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS command_dedup (
    command_id TEXT PRIMARY KEY,
    result_code TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
    device_id TEXT PRIMARY KEY,
    signing_public_key BLOB NOT NULL,
    encryption_public_key BLOB NOT NULL,
    revoked_at_ms INTEGER
);

CREATE TABLE IF NOT EXISTS device_cursors (
    device_id TEXT PRIMARY KEY REFERENCES devices(device_id),
    ack_event_seq INTEGER NOT NULL DEFAULT 0
);

PRAGMA user_version = 1;
`
