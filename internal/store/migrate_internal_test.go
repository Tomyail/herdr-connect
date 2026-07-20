package store

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
)

func TestUpgradeFromV1PreservesExistingData(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "v1.db")

	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("create v1 database: %v", err)
	}
	if _, err := db.ExecContext(ctx, migrationV1); err != nil {
		t.Fatalf("apply v1 migration: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
INSERT INTO devices(device_id, signing_public_key, encryption_public_key) VALUES ('dev_legacy', X'01', X'02')`); err != nil {
		t.Fatalf("insert v1 device row: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close v1 database: %v", err)
	}

	upgraded, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("open v1 database for upgrade: %v", err)
	}
	t.Cleanup(func() { _ = upgraded.Close() })
	if got := upgraded.SchemaVersion(); got != 2 {
		t.Fatalf("schema version after upgrade = %d, want 2", got)
	}

	var legacyCount int
	if err := upgraded.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM devices WHERE device_id = 'dev_legacy'`).Scan(&legacyCount); err != nil {
		t.Fatalf("read v1 device row: %v", err)
	}
	if legacyCount != 1 {
		t.Fatalf("v1 device row not preserved: count = %d", legacyCount)
	}
	var pairedCount int
	if err := upgraded.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM paired_devices`).Scan(&pairedCount); err != nil {
		t.Fatalf("v2 paired_devices table unavailable: %v", err)
	}
	if pairedCount != 0 {
		t.Fatalf("fresh paired_devices table not empty: count = %d", pairedCount)
	}
}
