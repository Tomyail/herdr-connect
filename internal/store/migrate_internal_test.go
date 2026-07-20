package store

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
)

func Test从v1库自动升级到v2且保留原有数据(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "v1.db")

	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("创建 v1 数据库: %v", err)
	}
	if _, err := db.ExecContext(ctx, migrationV1); err != nil {
		t.Fatalf("执行 v1 迁移: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
INSERT INTO devices(device_id, signing_public_key, encryption_public_key) VALUES ('dev_legacy', X'01', X'02')`); err != nil {
		t.Fatalf("写入 v1 设备数据: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("关闭 v1 数据库: %v", err)
	}

	upgraded, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("打开 v1 数据库升级: %v", err)
	}
	t.Cleanup(func() { _ = upgraded.Close() })
	if got := upgraded.SchemaVersion(); got != 2 {
		t.Fatalf("升级后 schema version = %d, want 2", got)
	}

	var legacyCount int
	if err := upgraded.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM devices WHERE device_id = 'dev_legacy'`).Scan(&legacyCount); err != nil {
		t.Fatalf("读取 v1 设备数据: %v", err)
	}
	if legacyCount != 1 {
		t.Fatalf("v1 设备数据未保留: count = %d", legacyCount)
	}
	var pairedCount int
	if err := upgraded.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM paired_devices`).Scan(&pairedCount); err != nil {
		t.Fatalf("v2 paired_devices 表不可用: %v", err)
	}
	if pairedCount != 0 {
		t.Fatalf("新建 paired_devices 表非空: count = %d", pairedCount)
	}
}
