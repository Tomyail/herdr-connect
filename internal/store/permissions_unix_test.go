//go:build unix

package store_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/Tomyail/herdr-connect/internal/store"
)

// POSIX 权限位断言只在 unix 上有意义：Windows 不用 mode bits 表达访问控制，
// Go 对可写文件一律报 0666，owner-only 语义由 DACL 承载（见
// permissions_windows_test.go）。
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
