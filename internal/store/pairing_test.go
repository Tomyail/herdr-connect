package store_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"path/filepath"
	"testing"
	"time"

	"github.com/Tomyail/herdr-connect/internal/store"
)

func hashOf(value string) []byte {
	sum := sha256.Sum256([]byte(value))
	return sum[:]
}

func TestPairingSecretIsSingleUse(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db, err := store.Open(ctx, filepath.Join(t.TempDir(), "daemon.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	now := time.Now()
	secretHash := hashOf("secret-1")
	if err := db.InsertPairingSecret(ctx, secretHash, now, now.Add(5*time.Minute)); err != nil {
		t.Fatalf("insert pairing secret: %v", err)
	}

	consumed, _, err := db.PairingSecretStatus(ctx, secretHash)
	if err != nil || consumed {
		t.Fatalf("initial status consumed=%v err=%v, want false nil", consumed, err)
	}

	ok, err := db.CompletePairing(ctx, secretHash, store.PairedDevice{
		DeviceID: "dev_1", Name: "iPhone", TokenHash: hashOf("token-1"),
	}, now)
	if err != nil || !ok {
		t.Fatalf("first pairing ok=%v err=%v, want true nil", ok, err)
	}

	ok, err = db.CompletePairing(ctx, secretHash, store.PairedDevice{
		DeviceID: "dev_2", Name: "iPad", TokenHash: hashOf("token-2"),
	}, now)
	if err != nil || ok {
		t.Fatalf("second consume ok=%v err=%v, want false nil", ok, err)
	}

	consumed, deviceID, err := db.PairingSecretStatus(ctx, secretHash)
	if err != nil || !consumed || deviceID != "dev_1" {
		t.Fatalf("status after consume consumed=%v deviceID=%q err=%v, want true dev_1 nil", consumed, deviceID, err)
	}
}

func TestExpiredSecretCannotCompletePairing(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db, err := store.Open(ctx, filepath.Join(t.TempDir(), "daemon.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	created := time.Now()
	secretHash := hashOf("secret-expired")
	if err := db.InsertPairingSecret(ctx, secretHash, created, created.Add(5*time.Minute)); err != nil {
		t.Fatalf("insert pairing secret: %v", err)
	}

	ok, err := db.CompletePairing(ctx, secretHash, store.PairedDevice{
		DeviceID: "dev_1", Name: "iPhone", TokenHash: hashOf("token-1"),
	}, created.Add(5*time.Minute+time.Second))
	if err != nil || ok {
		t.Fatalf("expired pairing ok=%v err=%v, want false nil", ok, err)
	}
	if _, found, err := db.GetPairedDevice(ctx, "dev_1"); err != nil || found {
		t.Fatalf("expired pairing must not leave a device row: found=%v err=%v", found, err)
	}
}

func TestConcurrentConsumeAcrossConnectionsOnlyOneSucceeds(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "daemon.db")
	first, err := store.Open(ctx, path)
	if err != nil {
		t.Fatalf("open first connection: %v", err)
	}
	t.Cleanup(func() { _ = first.Close() })
	second, err := store.Open(ctx, path)
	if err != nil {
		t.Fatalf("open second connection: %v", err)
	}
	t.Cleanup(func() { _ = second.Close() })

	now := time.Now()
	secretHash := hashOf("secret-race")
	if err := first.InsertPairingSecret(ctx, secretHash, now, now.Add(5*time.Minute)); err != nil {
		t.Fatalf("insert pairing secret: %v", err)
	}

	results := make(chan bool, 2)
	errs := make(chan error, 2)
	race := func(db *store.Store, deviceID, token string) {
		ok, err := db.CompletePairing(ctx, secretHash, store.PairedDevice{
			DeviceID: deviceID, Name: deviceID, TokenHash: hashOf(token),
		}, now)
		results <- ok
		errs <- err
	}
	go race(first, "dev_a", "token-a")
	go race(second, "dev_b", "token-b")

	successes := 0
	for i := 0; i < 2; i++ {
		if err := <-errs; err != nil {
			t.Fatalf("concurrent pairing error: %v", err)
		}
		if <-results {
			successes++
		}
	}
	if successes != 1 {
		t.Fatalf("concurrent consume successes = %d, want 1", successes)
	}
}

func TestTokenLookupAndRevocation(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db, err := store.Open(ctx, filepath.Join(t.TempDir(), "daemon.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	now := time.Now()
	secretHash := hashOf("secret-revoke")
	tokenHash := hashOf("token-revoke")
	if err := db.InsertPairingSecret(ctx, secretHash, now, now.Add(5*time.Minute)); err != nil {
		t.Fatalf("insert pairing secret: %v", err)
	}
	if ok, err := db.CompletePairing(ctx, secretHash, store.PairedDevice{
		DeviceID: "dev_r", Name: "iPhone", TokenHash: tokenHash,
	}, now); err != nil || !ok {
		t.Fatalf("pairing ok=%v err=%v, want true nil", ok, err)
	}

	device, found, err := db.FindPairedDeviceByTokenHash(ctx, tokenHash)
	if err != nil || !found {
		t.Fatalf("lookup by token found=%v err=%v, want true nil", found, err)
	}
	if device.DeviceID != "dev_r" || !bytes.Equal(device.TokenHash, tokenHash) || device.RevokedAtMs != nil {
		t.Fatalf("unexpected device record: %+v", device)
	}
	if _, found, err := db.FindPairedDeviceByTokenHash(ctx, hashOf("unknown")); err != nil || found {
		t.Fatalf("unknown token lookup found=%v err=%v, want false nil", found, err)
	}

	later := now.Add(time.Minute)
	if err := db.TouchDeviceLastSeen(ctx, "dev_r", later); err != nil {
		t.Fatalf("touch last seen: %v", err)
	}
	if err := db.RevokeDevice(ctx, "dev_r", later); err != nil {
		t.Fatalf("revoke device: %v", err)
	}
	if err := db.RevokeDevice(ctx, "dev_r", later); err == nil {
		t.Fatal("double revoke did not fail")
	}

	device, found, err = db.GetPairedDevice(ctx, "dev_r")
	if err != nil || !found {
		t.Fatalf("read revoked device found=%v err=%v", found, err)
	}
	if device.RevokedAtMs == nil || *device.RevokedAtMs != later.UnixMilli() {
		t.Fatalf("revocation time not recorded: %+v", device)
	}
	if device.LastSeenAtMs == nil || *device.LastSeenAtMs != later.UnixMilli() {
		t.Fatalf("last seen time not recorded: %+v", device)
	}
}

func TestListPairedDevicesEmptyDatabaseReturnsEmptySlice(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db, err := store.Open(ctx, filepath.Join(t.TempDir(), "daemon.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	devices, err := db.ListPairedDevices(ctx)
	if err != nil {
		t.Fatalf("list paired devices: %v", err)
	}
	if devices == nil {
		t.Fatal("ListPairedDevices returned nil, want empty slice")
	}
	if len(devices) != 0 {
		t.Fatalf("ListPairedDevices len=%d, want 0", len(devices))
	}
}

func TestListPairedDevicesReturnsSortedAndStatusAware(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db, err := store.Open(ctx, filepath.Join(t.TempDir(), "daemon.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	pair := func(deviceID, name, token string, now time.Time) {
		t.Helper()
		secretHash := hashOf("secret-" + deviceID)
		if err := db.InsertPairingSecret(ctx, secretHash, now, now.Add(5*time.Minute)); err != nil {
			t.Fatalf("insert secret for %s: %v", deviceID, err)
		}
		ok, err := db.CompletePairing(ctx, secretHash, store.PairedDevice{
			DeviceID: deviceID, Name: name, TokenHash: hashOf(token),
		}, now)
		if err != nil || !ok {
			t.Fatalf("pair %s: ok=%v err=%v", deviceID, ok, err)
		}
	}

	base := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	pair("dev_last", "Last", "tok-last", base.Add(30*time.Minute))
	pair("dev_first", "First", "tok-first", base.Add(10*time.Minute))
	pair("dev_revoked", "Revoked", "tok-revoked", base.Add(20*time.Minute))

	if err := db.RevokeDevice(ctx, "dev_revoked", base.Add(40*time.Minute)); err != nil {
		t.Fatalf("revoke device: %v", err)
	}

	devices, err := db.ListPairedDevices(ctx)
	if err != nil {
		t.Fatalf("list paired devices: %v", err)
	}
	if len(devices) != 3 {
		t.Fatalf("ListPairedDevices len=%d, want 3", len(devices))
	}

	// 按 paired_at_ms 升序排序。
	if devices[0].DeviceID != "dev_first" {
		t.Fatalf("first device = %s, want dev_first", devices[0].DeviceID)
	}
	if devices[1].DeviceID != "dev_revoked" {
		t.Fatalf("second device = %s, want dev_revoked", devices[1].DeviceID)
	}
	if devices[2].DeviceID != "dev_last" {
		t.Fatalf("third device = %s, want dev_last", devices[2].DeviceID)
	}

	// 已撤销设备 RevokedAtMs 非 nil，活跃设备 RevokedAtMs 为 nil。
	if devices[1].RevokedAtMs == nil {
		t.Fatal("revoked device has nil RevokedAtMs")
	}
	if devices[0].RevokedAtMs != nil {
		t.Fatal("active dev_first has non-nil RevokedAtMs")
	}
	if devices[2].RevokedAtMs != nil {
		t.Fatal("active dev_last has non-nil RevokedAtMs")
	}
}
