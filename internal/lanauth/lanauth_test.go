package lanauth_test

import (
	"context"
	"crypto/x509"
	"encoding/pem"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/Tomyail/herdr-connect/internal/lanauth"
	"github.com/Tomyail/herdr-connect/internal/store"
)

func openStore(t *testing.T) *store.Store {
	t.Helper()
	db, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "daemon.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestCertificateCreationIsIdempotent(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	first, err := lanauth.LoadOrCreateCertificate(dir)
	if err != nil {
		t.Fatalf("create certificate: %v", err)
	}
	second, err := lanauth.LoadOrCreateCertificate(dir)
	if err != nil {
		t.Fatalf("reload certificate: %v", err)
	}
	if first.Fingerprint != second.Fingerprint {
		t.Fatalf("fingerprints differ: %x vs %x", first.Fingerprint, second.Fingerprint)
	}
	if first.FingerprintBase64() == "" || len(first.FingerprintBase64()) != 43 {
		t.Fatalf("unexpected base64url fingerprint: %q", first.FingerprintBase64())
	}

	certPEM, err := os.ReadFile(filepath.Join(dir, lanauth.CertFileName))
	if err != nil {
		t.Fatalf("read certificate file: %v", err)
	}
	block, _ := pem.Decode(certPEM)
	if block == nil {
		t.Fatal("certificate file is not PEM")
	}
	parsed, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		t.Fatalf("parse certificate: %v", err)
	}
	if parsed.Subject.CommonName != "Herdr Connect LAN" {
		t.Fatalf("certificate CN = %q", parsed.Subject.CommonName)
	}
	if remaining := time.Until(parsed.NotAfter); remaining < 9*365*24*time.Hour {
		t.Fatalf("certificate validity too short: %v", remaining)
	}
}

func TestPrivateKeyIsOwnerOnly(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("Windows permissions use ACLs, verified separately")
	}

	dir := t.TempDir()
	if _, err := lanauth.LoadOrCreateCertificate(dir); err != nil {
		t.Fatalf("create certificate: %v", err)
	}
	info, err := os.Stat(filepath.Join(dir, lanauth.KeyFileName))
	if err != nil {
		t.Fatalf("stat private key: %v", err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Fatalf("private key permissions = %04o, want 0600", got)
	}
}

func TestConcurrentFirstCreationYieldsSameIdentity(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	type result struct {
		cert lanauth.Certificate
		err  error
	}
	results := make(chan result, 2)
	for i := 0; i < 2; i++ {
		go func() {
			cert, err := lanauth.LoadOrCreateCertificate(dir)
			results <- result{cert, err}
		}()
	}
	first := <-results
	second := <-results
	if first.err != nil || second.err != nil {
		t.Fatalf("concurrent creation errors: %v / %v", first.err, second.err)
	}
	if first.cert.Fingerprint != second.cert.Fingerprint {
		t.Fatal("concurrent creation produced different fingerprints")
	}
}

func TestPairingIssuesAuthenticatableTokenAndConsumesSecret(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db := openStore(t)

	secret, expiresAt, err := lanauth.NewPairingSecret(ctx, db)
	if err != nil {
		t.Fatalf("create pairing secret: %v", err)
	}
	if remaining := time.Until(expiresAt); remaining <= 4*time.Minute || remaining > 5*time.Minute {
		t.Fatalf("unexpected secret TTL: %v", remaining)
	}

	device, ok, err := lanauth.CompletePairing(ctx, db, secret, "  iPhone 15  ")
	if err != nil || !ok {
		t.Fatalf("pairing ok=%v err=%v, want true nil", ok, err)
	}
	if device.Name != "iPhone 15" {
		t.Fatalf("device name not trimmed: %q", device.Name)
	}
	if device.Token == "" || device.DeviceID == "" {
		t.Fatalf("incomplete issued device: %+v", device)
	}

	if _, ok, err := lanauth.CompletePairing(ctx, db, secret, "iPad"); err != nil || ok {
		t.Fatalf("second consume ok=%v err=%v, want false nil", ok, err)
	}

	deviceID, status, err := lanauth.Authenticate(ctx, db, device.Token)
	if err != nil || status != lanauth.AuthStatusOK || deviceID != device.DeviceID {
		t.Fatalf("authenticate deviceID=%q status=%v err=%v", deviceID, status, err)
	}
	stored, found, err := db.GetPairedDevice(ctx, device.DeviceID)
	if err != nil || !found {
		t.Fatalf("read device found=%v err=%v", found, err)
	}
	if stored.LastSeenAtMs == nil {
		t.Fatal("last seen not updated after authentication")
	}
}

func TestUnknownSecretAndEmptyDeviceNameAreRejected(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db := openStore(t)

	if _, ok, err := lanauth.CompletePairing(ctx, db, "no-such-secret", "iPhone"); err != nil || ok {
		t.Fatalf("unknown secret ok=%v err=%v, want false nil", ok, err)
	}
	if _, _, err := lanauth.CompletePairing(ctx, db, "whatever", "   "); err == nil {
		t.Fatal("empty device name did not fail")
	}
}

func TestAuthenticationFailsAfterRevocation(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db := openStore(t)

	secret, _, err := lanauth.NewPairingSecret(ctx, db)
	if err != nil {
		t.Fatalf("create pairing secret: %v", err)
	}
	device, ok, err := lanauth.CompletePairing(ctx, db, secret, "iPhone")
	if err != nil || !ok {
		t.Fatalf("pairing ok=%v err=%v", ok, err)
	}
	if err := lanauth.RevokeDevice(ctx, db, device.DeviceID); err != nil {
		t.Fatalf("revoke device: %v", err)
	}
	// 已撤销设备返回 AuthStatusRevoked，而非笼统的 AuthStatusMissing。
	_, status, err := lanauth.Authenticate(ctx, db, device.Token)
	if err != nil {
		t.Fatalf("authenticate after revoke err=%v", err)
	}
	if status != lanauth.AuthStatusRevoked {
		t.Fatalf("authenticate after revoke status=%v, want AuthStatusRevoked", status)
	}
	// 空 token 仍返回 AuthStatusMissing。
	_, status, err = lanauth.Authenticate(ctx, db, "")
	if err != nil {
		t.Fatalf("authenticate empty token err=%v", err)
	}
	if status != lanauth.AuthStatusMissing {
		t.Fatalf("authenticate empty token status=%v, want AuthStatusMissing", status)
	}
	// 未知 token 也返回 AuthStatusMissing。
	_, status, err = lanauth.Authenticate(ctx, db, "completely-unknown-token")
	if err != nil {
		t.Fatalf("authenticate unknown token err=%v", err)
	}
	if status != lanauth.AuthStatusMissing {
		t.Fatalf("authenticate unknown token status=%v, want AuthStatusMissing", status)
	}
}
