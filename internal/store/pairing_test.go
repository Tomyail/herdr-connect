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

func Test配对secret只能被消费一次(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db, err := store.Open(ctx, filepath.Join(t.TempDir(), "daemon.db"))
	if err != nil {
		t.Fatalf("打开数据库: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	now := time.Now()
	secretHash := hashOf("secret-1")
	if err := db.InsertPairingSecret(ctx, secretHash, now, now.Add(5*time.Minute)); err != nil {
		t.Fatalf("写入配对 secret: %v", err)
	}

	consumed, _, err := db.PairingSecretStatus(ctx, secretHash)
	if err != nil || consumed {
		t.Fatalf("初始状态 consumed=%v err=%v, want false nil", consumed, err)
	}

	ok, err := db.CompletePairing(ctx, secretHash, store.PairedDevice{
		DeviceID: "dev_1", Name: "iPhone", TokenHash: hashOf("token-1"),
	}, now)
	if err != nil || !ok {
		t.Fatalf("首次配对 ok=%v err=%v, want true nil", ok, err)
	}

	ok, err = db.CompletePairing(ctx, secretHash, store.PairedDevice{
		DeviceID: "dev_2", Name: "iPad", TokenHash: hashOf("token-2"),
	}, now)
	if err != nil || ok {
		t.Fatalf("二次消费 ok=%v err=%v, want false nil", ok, err)
	}

	consumed, deviceID, err := db.PairingSecretStatus(ctx, secretHash)
	if err != nil || !consumed || deviceID != "dev_1" {
		t.Fatalf("消费后状态 consumed=%v deviceID=%q err=%v, want true dev_1 nil", consumed, deviceID, err)
	}
}

func Test过期secret无法完成配对(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db, err := store.Open(ctx, filepath.Join(t.TempDir(), "daemon.db"))
	if err != nil {
		t.Fatalf("打开数据库: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	created := time.Now()
	secretHash := hashOf("secret-expired")
	if err := db.InsertPairingSecret(ctx, secretHash, created, created.Add(5*time.Minute)); err != nil {
		t.Fatalf("写入配对 secret: %v", err)
	}

	ok, err := db.CompletePairing(ctx, secretHash, store.PairedDevice{
		DeviceID: "dev_1", Name: "iPhone", TokenHash: hashOf("token-1"),
	}, created.Add(5*time.Minute+time.Second))
	if err != nil || ok {
		t.Fatalf("过期配对 ok=%v err=%v, want false nil", ok, err)
	}
	if _, found, err := db.GetPairedDevice(ctx, "dev_1"); err != nil || found {
		t.Fatalf("过期配对不应留下设备记录: found=%v err=%v", found, err)
	}
}

func Test两个进程并发消费同一secret只有一个成功(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "daemon.db")
	first, err := store.Open(ctx, path)
	if err != nil {
		t.Fatalf("打开第一个连接: %v", err)
	}
	t.Cleanup(func() { _ = first.Close() })
	second, err := store.Open(ctx, path)
	if err != nil {
		t.Fatalf("打开第二个连接: %v", err)
	}
	t.Cleanup(func() { _ = second.Close() })

	now := time.Now()
	secretHash := hashOf("secret-race")
	if err := first.InsertPairingSecret(ctx, secretHash, now, now.Add(5*time.Minute)); err != nil {
		t.Fatalf("写入配对 secret: %v", err)
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
			t.Fatalf("并发配对出错: %v", err)
		}
		if <-results {
			successes++
		}
	}
	if successes != 1 {
		t.Fatalf("并发消费成功次数 = %d, want 1", successes)
	}
}

func TestToken查找与撤销(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db, err := store.Open(ctx, filepath.Join(t.TempDir(), "daemon.db"))
	if err != nil {
		t.Fatalf("打开数据库: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	now := time.Now()
	secretHash := hashOf("secret-revoke")
	tokenHash := hashOf("token-revoke")
	if err := db.InsertPairingSecret(ctx, secretHash, now, now.Add(5*time.Minute)); err != nil {
		t.Fatalf("写入配对 secret: %v", err)
	}
	if ok, err := db.CompletePairing(ctx, secretHash, store.PairedDevice{
		DeviceID: "dev_r", Name: "iPhone", TokenHash: tokenHash,
	}, now); err != nil || !ok {
		t.Fatalf("配对 ok=%v err=%v, want true nil", ok, err)
	}

	device, found, err := db.FindPairedDeviceByTokenHash(ctx, tokenHash)
	if err != nil || !found {
		t.Fatalf("按 token 查找 found=%v err=%v, want true nil", found, err)
	}
	if device.DeviceID != "dev_r" || !bytes.Equal(device.TokenHash, tokenHash) || device.RevokedAtMs != nil {
		t.Fatalf("设备记录不符: %+v", device)
	}
	if _, found, err := db.FindPairedDeviceByTokenHash(ctx, hashOf("unknown")); err != nil || found {
		t.Fatalf("未知 token 查找 found=%v err=%v, want false nil", found, err)
	}

	later := now.Add(time.Minute)
	if err := db.TouchDeviceLastSeen(ctx, "dev_r", later); err != nil {
		t.Fatalf("更新活跃时间: %v", err)
	}
	if err := db.RevokeDevice(ctx, "dev_r", later); err != nil {
		t.Fatalf("撤销设备: %v", err)
	}
	if err := db.RevokeDevice(ctx, "dev_r", later); err == nil {
		t.Fatal("重复撤销未报错")
	}

	device, found, err = db.GetPairedDevice(ctx, "dev_r")
	if err != nil || !found {
		t.Fatalf("读取撤销后设备 found=%v err=%v", found, err)
	}
	if device.RevokedAtMs == nil || *device.RevokedAtMs != later.UnixMilli() {
		t.Fatalf("撤销时间未记录: %+v", device)
	}
	if device.LastSeenAtMs == nil || *device.LastSeenAtMs != later.UnixMilli() {
		t.Fatalf("活跃时间未记录: %+v", device)
	}
}
