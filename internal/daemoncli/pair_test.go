package daemoncli

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Tomyail/herdr-connect/internal/herdrsource"
	"github.com/Tomyail/herdr-connect/internal/lanauth"
	"github.com/Tomyail/herdr-connect/internal/store"
)

// fakeSourceCalls 记录 sourceFactory 是否被调用；pair 命令不得触发它。
type fakeSourceCalls struct {
	mu    sync.Mutex
	calls int
}

func (f *fakeSourceCalls) called() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

// knownPair 在真实临时 DB 中预先插入一个已知 secret（经真实 NewPairingSecret
// 哈希入库），并用真实 CompletePairing 消费它以建立对应 paired device，使
// runPair 最终的 GetPairedDevice 能查到 device 名与 id。
type knownPair struct {
	secret     string
	deviceID   string
	deviceName string
}

func seedKnownPair(t *testing.T, database *store.Store) knownPair {
	t.Helper()
	ctx := context.Background()
	plaintext, _, err := lanauth.NewPairingSecret(ctx, database)
	if err != nil {
		t.Fatalf("seed pairing secret: %v", err)
	}
	device, ok, err := lanauth.CompletePairing(ctx, database, plaintext, "known-device")
	if err != nil || !ok {
		t.Fatalf("seed paired device: ok=%v err=%v", ok, err)
	}
	return knownPair{secret: plaintext, deviceID: device.DeviceID, deviceName: device.Name}
}

func openTempStore(t *testing.T) (*store.Store, string) {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "daemon.db")
	database, err := store.Open(context.Background(), dbPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	return database, dir
}

func TestPairNoDaemonReturnsErrorAndDoesNotOpenDBOrCallSource(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	dbPath := filepath.Join(dir, "daemon.db")
	calls := &fakeSourceCalls{}

	// 通过真实 execute 路径验证：探活失败 → 退出非 0，且 DB 文件不存在、
	// sourceFactory 未被调用。
	var stdout, stderr bytes.Buffer
	code := ExecuteWithPreviewChecker(context.Background(),
		[]string{"--db", dbPath, "pair"},
		&stdout, &stderr,
		func(string) (herdrsource.Source, error) {
			calls.mu.Lock()
			calls.calls++
			calls.mu.Unlock()
			return nil, nil
		},
		func(context.Context) PreviewStatus { return PreviewAvailable },
	)
	if code == 0 {
		t.Fatalf("expected non-zero exit when no daemon is running; stdout=%q stderr=%q", stdout.String(), stderr.String())
	}
	if !strings.Contains(stderr.String(), "demo-lan") {
		t.Fatalf("stderr should hint at starting demo-lan: %q", stderr.String())
	}
	if got := calls.called(); got != 0 {
		t.Fatalf("sourceFactory called %d times; expected 0", got)
	}
	if _, err := os.Stat(dbPath); err == nil {
		t.Fatalf("DB file must not be created when daemon is down: %s", dbPath)
	}
	// 没有 daemon 时绝不能渲染 QR 或泄漏 secret。
	if strings.Contains(stdout.String(), "secret") || strings.Contains(stderr.String(), "secret") {
		t.Fatalf("output should not mention secret without daemon: stdout=%q stderr=%q", stdout.String(), stderr.String())
	}
}

func TestPairSucceedsOutputsDeviceNameAndIDAndConsumesAfterPolls(t *testing.T) {
	t.Parallel()

	database, dir := openTempStore(t)
	known := seedKnownPair(t, database)

	var pollCount int32
	const falsePolls = 2 // 前 2 次轮询 false，第 3 次起 true
	deps := pairDeps{
		newSecret: func(ctx context.Context, db *store.Store) (string, time.Time, error) {
			return known.secret, time.Now().Add(5 * time.Minute), nil
		},
		pollStatus: func(ctx context.Context, db *store.Store, hash []byte) (bool, string, error) {
			if atomic.AddInt32(&pollCount, 1) <= falsePolls {
				return false, "", nil
			}
			return true, known.deviceID, nil
		},
		addresses: func() []string { return []string{"10.0.0.5", "192.168.1.1", "fd00::1", "2001:db8::7"} },
		renderQR: func(payload pairingQR, writer io.Writer) {
			// 捕获 payload 写入轻量占位行，避免污染断言；不渲染真实 QR 块。
			encoded, _ := json.Marshal(payload)
			_, _ = writer.Write([]byte("qr:" + string(encoded) + "\n"))
		},
		now:          time.Now,
		sleep:        func(context.Context, time.Duration) error { return nil },
		pollInterval: time.Millisecond,
	}

	var stdout, stderr bytes.Buffer
	done := make(chan int, 1)
	go func() { done <- runPair(context.Background(), deps, database, dir, &stdout, &stderr) }()
	select {
	case code := <-done:
		if code != 0 {
			t.Fatalf("expected exit 0; got %d, stderr=%q, stdout=%q", code, stderr.String(), stdout.String())
		}
	case <-time.After(5 * time.Second):
		t.Fatalf("runPair did not return; stderr=%q stdout=%q", stderr.String(), stdout.String())
	}

	out := stdout.String()
	if !strings.Contains(out, known.deviceName) {
		t.Fatalf("stdout should report device name %q: %q", known.deviceName, out)
	}
	if !strings.Contains(out, known.deviceID) {
		t.Fatalf("stdout should report device_id %q: %q", known.deviceID, out)
	}
	before, after, ok := splitQRHosts(out)
	if !ok {
		t.Fatalf("could not parse QR payload from stdout: %q", out)
	}
	if !allIPv4BeforeIPv6(before, after) {
		t.Fatalf("IPv4 must precede IPv6; before=%v after=%v", before, after)
	}
	if got := atomic.LoadInt32(&pollCount); got <= falsePolls {
		t.Fatalf("pollStatus should have been called more than %d times; got %d", falsePolls, got)
	}
}

func TestCollectLANHostsSortsIPv4BeforeIPv6(t *testing.T) {
	t.Parallel()
	// 对真实本机地址清单断言：若同时存在 v4/v6，v4 段必须在 v6 段之前。
	hosts := collectLANHosts()
	v6Start := -1
	for i, h := range hosts {
		if strings.Contains(h, ":") && v6Start < 0 {
			v6Start = i
		}
		if v6Start >= 0 && !strings.Contains(h, ":") {
			t.Fatalf("IPv4 address %q appears after IPv6 entries: %v", h, hosts)
		}
	}
}

func splitQRHosts(output string) (before, after []string, ok bool) {
	idx := strings.Index(output, "qr:")
	if idx < 0 {
		return nil, nil, false
	}
	rest := output[idx+len("qr:"):]
	end := strings.IndexByte(rest, '\n')
	if end < 0 {
		end = len(rest)
	}
	var payload pairingQR
	if err := json.Unmarshal([]byte(rest[:end]), &payload); err != nil {
		return nil, nil, false
	}
	splitAt := len(payload.Hosts)
	for i, h := range payload.Hosts {
		if strings.Contains(h, ":") {
			splitAt = i
			break
		}
	}
	return payload.Hosts[:splitAt], payload.Hosts[splitAt:], true
}

func allIPv4BeforeIPv6(before, after []string) bool {
	for _, h := range before {
		if strings.Contains(h, ":") {
			return false
		}
	}
	for _, h := range after {
		if !strings.Contains(h, ":") {
			return false
		}
	}
	return len(before) > 0 && len(after) > 0
}
