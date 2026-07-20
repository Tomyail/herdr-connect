package daemoncli_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Tomyail/herdr-connect/internal/daemoncli"
	"github.com/Tomyail/herdr-connect/internal/herdrsource"
	"github.com/Tomyail/herdr-connect/internal/store"
)

func TestDevicesListEmptyDatabase(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "daemon.db")
	var stdout, stderr bytes.Buffer
	code := daemoncli.Execute(context.Background(), []string{"--db", dbPath, "devices", "list"}, &stdout, &stderr, fakeFactory)
	if code != 0 {
		t.Fatalf("exit = %d, stderr = %s", code, stderr.String())
	}
	var entries []map[string]any
	if err := json.Unmarshal(stdout.Bytes(), &entries); err != nil {
		t.Fatalf("parse devices list JSON: %v\n%s", err, stdout.String())
	}
	if entries == nil {
		t.Fatal("devices list returned null, want empty JSON array")
	}
	if len(entries) != 0 {
		t.Fatalf("devices list len=%d, want 0", len(entries))
	}
}

func TestDevicesListWithEntries(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "daemon.db")

	// 先配对两个设备。
	pairDevice(t, dbPath, "iPhone", "tok-iphone")
	pairDevice(t, dbPath, "iPad", "tok-ipad")

	var stdout, stderr bytes.Buffer
	code := daemoncli.Execute(context.Background(), []string{"--db", dbPath, "devices", "list"}, &stdout, &stderr, fakeFactory)
	if code != 0 {
		t.Fatalf("exit = %d, stderr = %s", code, stderr.String())
	}
	var entries []map[string]any
	if err := json.Unmarshal(stdout.Bytes(), &entries); err != nil {
		t.Fatalf("parse devices list JSON: %v\n%s", err, stdout.String())
	}
	if len(entries) != 2 {
		t.Fatalf("devices list len=%d, want 2", len(entries))
	}
	for _, entry := range entries {
		for _, field := range []string{"device_id", "name", "paired_at", "status"} {
			if _, ok := entry[field]; !ok {
				t.Fatalf("entry missing field %q: %#v", field, entry)
			}
		}
		if entry["status"] != "active" {
			t.Fatalf("device status = %q, want active", entry["status"])
		}
	}
}

func TestDevicesListIncludesRevoked(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "daemon.db")
	pairDevice(t, dbPath, "RevokedDevice", "tok-revoked")

	// 撤销设备。
	var stdout, stderr bytes.Buffer
	code := daemoncli.Execute(context.Background(), []string{"--db", dbPath, "devices", "list"}, &stdout, &stderr, fakeFactory)
	if code != 0 {
		t.Fatalf("exit = %d, stderr = %s", code, stderr.String())
	}
	var entries []map[string]any
	if err := json.Unmarshal(stdout.Bytes(), &entries); err != nil {
		t.Fatalf("parse devices list JSON: %v\n%s", err, stdout.String())
	}
	deviceID := entries[0]["device_id"].(string)

	stdout.Reset()
	stderr.Reset()
	code = daemoncli.Execute(context.Background(), []string{"--db", dbPath, "devices", "revoke", deviceID}, &stdout, &stderr, fakeFactory)
	if code != 0 {
		t.Fatalf("revoke exit = %d, stderr = %s", code, stderr.String())
	}

	stdout.Reset()
	stderr.Reset()
	code = daemoncli.Execute(context.Background(), []string{"--db", dbPath, "devices", "list"}, &stdout, &stderr, fakeFactory)
	if code != 0 {
		t.Fatalf("list after revoke exit = %d, stderr = %s", code, stderr.String())
	}
	entries = nil
	if err := json.Unmarshal(stdout.Bytes(), &entries); err != nil {
		t.Fatalf("parse revoked list JSON: %v\n%s", err, stdout.String())
	}
	if len(entries) != 1 {
		t.Fatalf("list after revoke len=%d, want 1", len(entries))
	}
	if entries[0]["status"] != "revoked" {
		t.Fatalf("device status = %q, want revoked", entries[0]["status"])
	}
	if entries[0]["revoked_at"] == nil {
		t.Fatal("revoked device missing revoked_at field")
	}
}

func TestDevicesRevokeSuccess(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "daemon.db")
	pairDevice(t, dbPath, "iPhone", "tok-iphone")

	// 先列出设备取 device_id。
	var stdout, stderr bytes.Buffer
	code := daemoncli.Execute(context.Background(), []string{"--db", dbPath, "devices", "list"}, &stdout, &stderr, fakeFactory)
	if code != 0 {
		t.Fatalf("list exit = %d, stderr = %s", code, stderr.String())
	}
	var entries []map[string]any
	if err := json.Unmarshal(stdout.Bytes(), &entries); err != nil {
		t.Fatalf("parse list: %v", err)
	}
	deviceID := entries[0]["device_id"].(string)

	stdout.Reset()
	stderr.Reset()
	code = daemoncli.Execute(context.Background(), []string{"--db", dbPath, "devices", "revoke", deviceID}, &stdout, &stderr, fakeFactory)
	if code != 0 {
		t.Fatalf("revoke exit = %d, stderr = %s", code, stderr.String())
	}
	if !strings.Contains(stdout.String(), "Revoked") || !strings.Contains(stdout.String(), deviceID) {
		t.Fatalf("revoke output missing confirmation: %s", stdout.String())
	}
}

func TestDevicesRevokeNotFound(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "daemon.db")
	var stdout, stderr bytes.Buffer
	code := daemoncli.Execute(context.Background(), []string{"--db", dbPath, "devices", "revoke", "dev_nonexistent"}, &stdout, &stderr, fakeFactory)
	if code != 1 {
		t.Fatalf("exit = %d, want 1; stdout=%s stderr=%s", code, stdout.String(), stderr.String())
	}
	if !strings.Contains(stderr.String(), "not found") {
		t.Fatalf("stderr missing 'not found': %s", stderr.String())
	}
	if stdout.Len() != 0 {
		t.Fatalf("stdout on error: %s", stdout.String())
	}
}

func TestDevicesRevokeDoubleRevokeFails(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "daemon.db")
	pairDevice(t, dbPath, "iPhone", "tok-iphone")

	var stdout, stderr bytes.Buffer
	code := daemoncli.Execute(context.Background(), []string{"--db", dbPath, "devices", "list"}, &stdout, &stderr, fakeFactory)
	if code != 0 {
		t.Fatalf("list exit = %d, stderr = %s", code, stderr.String())
	}
	var entries []map[string]any
	if err := json.Unmarshal(stdout.Bytes(), &entries); err != nil {
		t.Fatalf("parse list: %v", err)
	}
	deviceID := entries[0]["device_id"].(string)

	// 第一次撤销成功。
	stdout.Reset()
	stderr.Reset()
	code = daemoncli.Execute(context.Background(), []string{"--db", dbPath, "devices", "revoke", deviceID}, &stdout, &stderr, fakeFactory)
	if code != 0 {
		t.Fatalf("first revoke exit = %d, stderr = %s", code, stderr.String())
	}

	// 第二次撤销失败。
	stdout.Reset()
	stderr.Reset()
	code = daemoncli.Execute(context.Background(), []string{"--db", dbPath, "devices", "revoke", deviceID}, &stdout, &stderr, fakeFactory)
	if code != 1 {
		t.Fatalf("second revoke exit = %d, want 1; stdout=%s stderr=%s", code, stdout.String(), stderr.String())
	}
	if !strings.Contains(stderr.String(), "device not found or already revoked") {
		t.Fatalf("stderr missing expected error: %s", stderr.String())
	}
}

func TestDevicesHelpText(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "must-not-exist.db")
	tests := []struct {
		name       string
		args       []string
		wantOutput string
	}{
		{name: "top level help includes devices", args: []string{"--help"}, wantOutput: "devices       List and revoke paired devices"},
		{name: "devices command help", args: []string{"help", "devices"}, wantOutput: "devices <list|revoke <device_id>>"},
		{name: "devices --help", args: []string{"devices", "--help"}, wantOutput: "devices <list|revoke <device_id>>"},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			args := append([]string{"--db", dbPath}, test.args...)
			var stdout, stderr bytes.Buffer
			code := daemoncli.Execute(context.Background(), args, &stdout, &stderr, fakeFactory)
			if code != 0 {
				t.Fatalf("exit = %d, stderr = %s", code, stderr.String())
			}
			if !strings.Contains(stdout.String(), test.wantOutput) {
				t.Fatalf("output missing %q: %s", test.wantOutput, stdout.String())
			}
		})
	}
}

func TestDevicesValidationErrors(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "must-not-exist.db")
	tests := []struct {
		name       string
		args       []string
		wantOutput string
	}{
		{name: "no subcommand", args: []string{"devices"}, wantOutput: "devices requires a subcommand"},
		{name: "unknown subcommand", args: []string{"devices", "delete"}, wantOutput: "unknown devices subcommand"},
		{name: "list with args", args: []string{"devices", "list", "extra"}, wantOutput: "does not accept arguments"},
		{name: "revoke without id", args: []string{"devices", "revoke"}, wantOutput: "devices revoke requires a <device_id>"},
		{name: "revoke with extra args", args: []string{"devices", "revoke", "id1", "id2"}, wantOutput: "devices revoke requires a <device_id>"},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			args := append([]string{"--db", dbPath}, test.args...)
			var stdout, stderr bytes.Buffer
			code := daemoncli.Execute(context.Background(), args, &stdout, &stderr, fakeFactory)
			if code != 2 {
				t.Fatalf("exit = %d, want 2; stdout=%q stderr=%q", code, stdout.String(), stderr.String())
			}
			if !strings.Contains(stderr.String(), test.wantOutput) {
				t.Fatalf("stderr missing %q: %s", test.wantOutput, stderr.String())
			}
		})
	}
}

func TestDevicesSkipsSourceFactory(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "daemon.db")
	var stdout, stderr bytes.Buffer
	code := daemoncli.Execute(context.Background(), []string{"--db", dbPath, "devices", "list"}, &stdout, &stderr, func(string) (herdrsource.Source, error) {
		t.Fatal("source factory must not be called for devices command")
		return nil, nil
	})
	if code != 0 {
		t.Fatalf("exit = %d, stderr = %s", code, stderr.String())
	}
}

// pairDevice 在测试中创建一个已配对的设备（绕过 pair CLI，直接操作 store）。
func pairDevice(t *testing.T, dbPath, name, token string) string {
	t.Helper()
	ctx := context.Background()
	db, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatalf("open database for pairing: %v", err)
	}
	defer db.Close()

	secretHash := sha256.Sum256([]byte("secret-" + name + token))
	now := time.Now()
	if err := db.InsertPairingSecret(ctx, secretHash[:], now, now.Add(5*time.Minute)); err != nil {
		t.Fatalf("insert secret: %v", err)
	}
	ok, err := db.CompletePairing(ctx, secretHash[:], store.PairedDevice{
		DeviceID: name + "-dev", Name: name, TokenHash: sha256Hash(token),
	}, now)
	if err != nil || !ok {
		t.Fatalf("pair device: ok=%v err=%v", ok, err)
	}
	return name + "-dev"
}

func sha256Hash(value string) []byte {
	sum := sha256.Sum256([]byte(value))
	return sum[:]
}
