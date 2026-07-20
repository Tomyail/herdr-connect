package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type PairedDevice struct {
	DeviceID     string
	Name         string
	TokenHash    []byte
	PairedAtMs   int64
	LastSeenAtMs *int64
	RevokedAtMs  *int64
}

func (s *Store) InsertPairingSecret(ctx context.Context, secretHash []byte, createdAt, expiresAt time.Time) error {
	if _, err := s.db.ExecContext(ctx, `
INSERT INTO pairing_secrets(secret_hash, created_at_ms, expires_at_ms) VALUES (?, ?, ?)`,
		secretHash, createdAt.UnixMilli(), expiresAt.UnixMilli()); err != nil {
		return fmt.Errorf("insert pairing secret: %w", err)
	}
	return nil
}

// PairingSecretStatus 供 pair 命令轮询：secret 被消费后返回 consumed=true 与对应 device_id。
func (s *Store) PairingSecretStatus(ctx context.Context, secretHash []byte) (consumed bool, deviceID string, err error) {
	var consumedAt sql.NullInt64
	var device sql.NullString
	err = s.db.QueryRowContext(ctx, `
SELECT consumed_at_ms, device_id FROM pairing_secrets WHERE secret_hash = ?`, secretHash).
		Scan(&consumedAt, &device)
	if err == sql.ErrNoRows {
		return false, "", fmt.Errorf("pairing secret not found")
	}
	if err != nil {
		return false, "", fmt.Errorf("read pairing secret status: %w", err)
	}
	return consumedAt.Valid, device.String, nil
}

// CompletePairing 在单个事务内校验 secret（存在、未过期、未消费）、创建配对设备并消费 secret。
// secret 无效的所有原因（不存在/过期/已消费）统一返回 ok=false，不区分，避免向未认证调用方泄露状态。
func (s *Store) CompletePairing(ctx context.Context, secretHash []byte, device PairedDevice, now time.Time) (ok bool, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, fmt.Errorf("begin pairing transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	// 事务的第一条语句必须是写操作：deferred 事务先读后写时，WAL 模式下的
	// 写锁升级失败会立即返回 SQLITE_BUSY 且 busy_timeout 不生效。
	// 条件 UPDATE 同时完成"校验 + 消费"，天然原子。
	result, err := tx.ExecContext(ctx, `
UPDATE pairing_secrets SET consumed_at_ms = ?
WHERE secret_hash = ? AND consumed_at_ms IS NULL AND expires_at_ms > ?`,
		now.UnixMilli(), secretHash, now.UnixMilli())
	if err != nil {
		return false, fmt.Errorf("consume pairing secret: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("read pairing secret consume result: %w", err)
	}
	if affected == 0 {
		return false, nil
	}
	if _, err := tx.ExecContext(ctx, `
INSERT INTO paired_devices(device_id, name, token_hash, paired_at_ms) VALUES (?, ?, ?, ?)`,
		device.DeviceID, device.Name, device.TokenHash, now.UnixMilli()); err != nil {
		return false, fmt.Errorf("insert paired device: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
UPDATE pairing_secrets SET device_id = ? WHERE secret_hash = ?`,
		device.DeviceID, secretHash); err != nil {
		return false, fmt.Errorf("link paired device to secret: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return false, fmt.Errorf("commit pairing transaction: %w", err)
	}
	return true, nil
}

func (s *Store) FindPairedDeviceByTokenHash(ctx context.Context, tokenHash []byte) (PairedDevice, bool, error) {
	device, err := scanPairedDevice(s.db.QueryRowContext(ctx, `
SELECT device_id, name, token_hash, paired_at_ms, last_seen_at_ms, revoked_at_ms
FROM paired_devices WHERE token_hash = ?`, tokenHash))
	if err == sql.ErrNoRows {
		return PairedDevice{}, false, nil
	}
	if err != nil {
		return PairedDevice{}, false, fmt.Errorf("find paired device by token: %w", err)
	}
	return device, true, nil
}

func (s *Store) GetPairedDevice(ctx context.Context, deviceID string) (PairedDevice, bool, error) {
	device, err := scanPairedDevice(s.db.QueryRowContext(ctx, `
SELECT device_id, name, token_hash, paired_at_ms, last_seen_at_ms, revoked_at_ms
FROM paired_devices WHERE device_id = ?`, deviceID))
	if err == sql.ErrNoRows {
		return PairedDevice{}, false, nil
	}
	if err != nil {
		return PairedDevice{}, false, fmt.Errorf("read paired device: %w", err)
	}
	return device, true, nil
}

func (s *Store) TouchDeviceLastSeen(ctx context.Context, deviceID string, now time.Time) error {
	if _, err := s.db.ExecContext(ctx, `
UPDATE paired_devices SET last_seen_at_ms = ? WHERE device_id = ?`, now.UnixMilli(), deviceID); err != nil {
		return fmt.Errorf("update device last seen: %w", err)
	}
	return nil
}

func (s *Store) RevokeDevice(ctx context.Context, deviceID string, now time.Time) error {
	result, err := s.db.ExecContext(ctx, `
UPDATE paired_devices SET revoked_at_ms = ? WHERE device_id = ? AND revoked_at_ms IS NULL`, now.UnixMilli(), deviceID)
	if err != nil {
		return fmt.Errorf("revoke paired device: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read revoke result: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("device not found or already revoked")
	}
	return nil
}

func (s *Store) ListPairedDevices(ctx context.Context) ([]PairedDevice, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT device_id, name, token_hash, paired_at_ms, last_seen_at_ms, revoked_at_ms
FROM paired_devices ORDER BY paired_at_ms`)
	if err != nil {
		return nil, fmt.Errorf("list paired devices: %w", err)
	}
	defer rows.Close()
	devices := make([]PairedDevice, 0)
	for rows.Next() {
		device, err := scanPairedDevice(rows)
		if err != nil {
			return nil, fmt.Errorf("scan paired device: %w", err)
		}
		devices = append(devices, device)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate paired devices: %w", err)
	}
	return devices, nil
}

func scanPairedDevice(row rowScanner) (PairedDevice, error) {
	var device PairedDevice
	var lastSeen, revoked sql.NullInt64
	err := row.Scan(&device.DeviceID, &device.Name, &device.TokenHash, &device.PairedAtMs, &lastSeen, &revoked)
	if err != nil {
		return PairedDevice{}, err
	}
	if lastSeen.Valid {
		device.LastSeenAtMs = &lastSeen.Int64
	}
	if revoked.Valid {
		device.RevokedAtMs = &revoked.Int64
	}
	return device, nil
}
