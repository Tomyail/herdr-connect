//go:build !windows

package store

import (
	"fmt"
	"os"
	"path/filepath"
)

func prepareSecureDatabase(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("创建数据库目录: %w", err)
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return fmt.Errorf("创建数据库文件: %w", err)
	}
	if err := file.Chmod(0o600); err != nil {
		_ = file.Close()
		return fmt.Errorf("收紧数据库文件权限: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("关闭预创建数据库文件: %w", err)
	}
	return nil
}

func secureSQLiteFiles(path string) error {
	for _, candidate := range []string{path, path + "-wal", path + "-shm"} {
		if err := os.Chmod(candidate, 0o600); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("收紧 SQLite 文件权限: %w", err)
		}
	}
	return nil
}
