//go:build !windows

package lanauth

import (
	"fmt"
	"os"
)

func secureKeyFile(path string) error {
	if err := os.Chmod(path, 0o600); err != nil {
		return fmt.Errorf("tighten private key permissions: %w", err)
	}
	return nil
}
