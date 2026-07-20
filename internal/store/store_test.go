package store_test

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Tomyail/herdr-connect/internal/store"
)

func Test空库迁移可重复执行且序列在重启后继续递增(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "daemon.db")

	first, err := store.Open(ctx, path)
	if err != nil {
		t.Fatalf("首次打开数据库: %v", err)
	}
	if got := first.SchemaVersion(); got != 2 {
		t.Fatalf("schema version = %d, want 2", got)
	}
	err = first.ApplyProjectionBatch(ctx, store.ProjectionBatch{SourceName: "fake", Cursor: "1", Updates: []store.AgentUpdate{{
		SourceRevision: 1, Record: store.AgentRecord{SourceID: "agent-1", InteractionState: "unknown"},
	}}})
	if err != nil {
		t.Fatalf("写入首个生命周期事实: %v", err)
	}
	seq, err := first.CurrentEventSeq(ctx)
	if err != nil {
		t.Fatalf("读取首个 event_seq: %v", err)
	}
	if seq != 1 {
		t.Fatalf("首个 event_seq = %d, want 1", seq)
	}
	if err := first.Close(); err != nil {
		t.Fatalf("关闭数据库: %v", err)
	}

	second, err := store.Open(ctx, path)
	if err != nil {
		t.Fatalf("重复打开数据库: %v", err)
	}
	t.Cleanup(func() { _ = second.Close() })
	err = second.ApplyProjectionBatch(ctx, store.ProjectionBatch{SourceName: "fake", Cursor: "2", Updates: []store.AgentUpdate{{
		SourceRevision: 2, Record: store.AgentRecord{SourceID: "agent-1", InteractionState: "working"},
	}}})
	if err != nil {
		t.Fatalf("重启后写入生命周期事实: %v", err)
	}
	seq, err = second.CurrentEventSeq(ctx)
	if err != nil {
		t.Fatalf("读取重启后的 event_seq: %v", err)
	}
	if seq != 2 {
		t.Fatalf("重启后的 event_seq = %d, want 2", seq)
	}
}

func Test数据库文件权限只允许当前所有者访问(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), "daemon.db")
	db, err := store.Open(context.Background(), path)
	if err != nil {
		t.Fatalf("打开数据库: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("读取数据库权限: %v", err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("数据库权限 = %04o, want 0600", got)
	}
}

func Test不会打开高于当前版本的数据库(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "future.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("创建未来版本数据库: %v", err)
	}
	if _, err := db.ExecContext(ctx, `PRAGMA user_version = 3`); err != nil {
		t.Fatalf("设置未来 schema version: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("关闭未来版本数据库: %v", err)
	}

	_, err = store.Open(ctx, path)
	if err == nil || !strings.Contains(err.Error(), "newer than supported") {
		t.Fatalf("打开未来版本数据库 error = %v", err)
	}
}

func Test投影批次失败时事实Outbox与Cursor一起回滚(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db, err := store.Open(ctx, filepath.Join(t.TempDir(), "daemon.db"))
	if err != nil {
		t.Fatalf("打开数据库: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	err = db.ApplyProjectionBatch(ctx, store.ProjectionBatch{
		SourceName: "fake",
		Cursor:     "2",
		Updates: []store.AgentUpdate{
			{SourceRevision: 1, Record: store.AgentRecord{SourceID: "agent-1", InteractionState: "working"}},
			{SourceRevision: 1, Record: store.AgentRecord{SourceID: "agent-2", InteractionState: "invalid"}},
		},
	})
	if err == nil {
		t.Fatal("无效批次未失败")
	}
	seq, err := db.CurrentEventSeq(ctx)
	if err != nil {
		t.Fatalf("读取回滚后的 event_seq: %v", err)
	}
	cursor, err := db.SourceCursor(ctx, "fake")
	if err != nil {
		t.Fatalf("读取回滚后的 cursor: %v", err)
	}
	agents, err := db.ActiveAgents(ctx)
	if err != nil {
		t.Fatalf("读取回滚后的 Agent: %v", err)
	}
	if seq != 0 || cursor != "" || len(agents) != 0 {
		t.Fatalf("批次未完全回滚: seq=%d cursor=%q agents=%d", seq, cursor, len(agents))
	}
}
