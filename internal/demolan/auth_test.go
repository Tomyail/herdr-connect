package demolan

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Tomyail/herdr-connect/internal/herdrsource"
	"github.com/Tomyail/herdr-connect/internal/lanauth"
	"github.com/Tomyail/herdr-connect/internal/store"
)

type secureFixture struct {
	handler  http.Handler
	database *store.Store
	cert     lanauth.Certificate
}

func newSecureFixture(t *testing.T) secureFixture {
	t.Helper()
	database, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "daemon.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	cert, err := lanauth.LoadOrCreateCertificate(t.TempDir())
	if err != nil {
		t.Fatalf("create certificate: %v", err)
	}
	source := &sequenceSource{snapshots: []herdrsource.Snapshot{
		{Online: true, Agents: []herdrsource.AgentObservation{{SourceID: "term-1", DisplayName: "Agent", Revision: 1, InteractionState: herdrsource.InteractionWorking}}},
	}}
	return secureFixture{handler: secureHandler(NewHandler(source), database, cert), database: database, cert: cert}
}

func (f secureFixture) pair(t *testing.T, secret, deviceName string) PairResponse {
	t.Helper()
	body := fmt.Sprintf(`{"device_name":%q,"secret":%q}`, deviceName, secret)
	response := httptest.NewRecorder()
	f.handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, PairPath, strings.NewReader(body)))
	if response.Code != http.StatusOK {
		t.Fatalf("pair status = %d, body = %s", response.Code, response.Body.String())
	}
	var pairResponse PairResponse
	if err := json.Unmarshal(response.Body.Bytes(), &pairResponse); err != nil {
		t.Fatalf("decode pair response: %v", err)
	}
	return pairResponse
}

func TestUnauthenticatedRequestsGetStructured401(t *testing.T) {
	fixture := newSecureFixture(t)

	for name, request := range map[string]*http.Request{
		"no token":    httptest.NewRequest(http.MethodGet, Path, nil),
		"wrong token": httptest.NewRequest(http.MethodGet, Path, nil),
	} {
		if name == "wrong token" {
			request.Header.Set("Authorization", "Bearer bogus")
		}
		response := httptest.NewRecorder()
		fixture.handler.ServeHTTP(response, request)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("%s: status = %d, want 401", name, response.Code)
		}
		assertErrorCode(t, response, "unauthorized")
		// 存活探测依赖这两个标记：401 也必须带上。
		if response.Header().Get("X-Herdr-Connect-Demo-Version") == "" {
			t.Fatalf("%s: missing demo version header", name)
		}
		if !strings.Contains(response.Body.String(), `"demo_version"`) {
			t.Fatalf("%s: missing demo_version field: %s", name, response.Body.String())
		}
	}
}

func TestPairingFlowIssuesTokenAndAuthorizesRequests(t *testing.T) {
	fixture := newSecureFixture(t)
	ctx := context.Background()

	secret, _, err := lanauth.NewPairingSecret(ctx, fixture.database)
	if err != nil {
		t.Fatalf("create pairing secret: %v", err)
	}
	paired := fixture.pair(t, secret, "iPhone 15")
	if paired.Token == "" || paired.DeviceID == "" {
		t.Fatalf("incomplete pair response: %+v", paired)
	}
	if paired.Fingerprint != fixture.cert.FingerprintBase64() {
		t.Fatalf("fingerprint = %q, want %q", paired.Fingerprint, fixture.cert.FingerprintBase64())
	}

	request := httptest.NewRequest(http.MethodGet, Path, nil)
	request.Header.Set("Authorization", "Bearer "+paired.Token)
	response := httptest.NewRecorder()
	fixture.handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("authorized request status = %d, body = %s", response.Code, response.Body.String())
	}

	// 同一 secret 不能再次使用。
	replay := httptest.NewRecorder()
	body := fmt.Sprintf(`{"device_name":"iPad","secret":%q}`, secret)
	fixture.handler.ServeHTTP(replay, httptest.NewRequest(http.MethodPost, PairPath, strings.NewReader(body)))
	if replay.Code != http.StatusBadRequest {
		t.Fatalf("replay status = %d, want 400", replay.Code)
	}
	assertErrorCode(t, replay, "pairing_secret_invalid")
}

func TestExpiredPairingSecretUsesTheUnifiedInvalidResponse(t *testing.T) {
	fixture := newSecureFixture(t)
	secret := "expired-secret"
	secretHash := sha256.Sum256([]byte(secret))
	now := time.Now()
	if err := fixture.database.InsertPairingSecret(context.Background(), secretHash[:], now.Add(-2*time.Minute), now.Add(-time.Minute)); err != nil {
		t.Fatalf("insert expired pairing secret: %v", err)
	}

	response := httptest.NewRecorder()
	body := fmt.Sprintf(`{"device_name":"iPhone","secret":%q}`, secret)
	fixture.handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, PairPath, strings.NewReader(body)))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expired secret status = %d, want 400", response.Code)
	}
	assertErrorCode(t, response, "pairing_secret_invalid")
}

func TestRevokedTokenIsRejected(t *testing.T) {
	fixture := newSecureFixture(t)
	ctx := context.Background()

	secret, _, err := lanauth.NewPairingSecret(ctx, fixture.database)
	if err != nil {
		t.Fatalf("create pairing secret: %v", err)
	}
	paired := fixture.pair(t, secret, "iPhone")
	if err := lanauth.RevokeDevice(ctx, fixture.database, paired.DeviceID); err != nil {
		t.Fatalf("revoke device: %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, Path, nil)
	request.Header.Set("Authorization", "Bearer "+paired.Token)
	response := httptest.NewRecorder()
	fixture.handler.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("revoked token status = %d, want 401", response.Code)
	}
	assertErrorCode(t, response, "unauthorized")
}

func TestPairEndpointValidatesMethodAndBody(t *testing.T) {
	fixture := newSecureFixture(t)

	response := httptest.NewRecorder()
	fixture.handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, PairPath, nil))
	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET pair status = %d, want 405", response.Code)
	}

	for name, body := range map[string]string{
		"not json":      "not-json",
		"unknown field": `{"device_name":"iPhone","secret":"s","extra":1}`,
		"empty name":    `{"device_name":"   ","secret":"s"}`,
		"empty secret":  `{"device_name":"iPhone","secret":""}`,
		"name too long": fmt.Sprintf(`{"device_name":%q,"secret":"s"}`, strings.Repeat("x", 101)),
	} {
		response := httptest.NewRecorder()
		fixture.handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, PairPath, strings.NewReader(body)))
		if response.Code != http.StatusBadRequest {
			t.Fatalf("%s: status = %d, want 400", name, response.Code)
		}
		assertErrorCode(t, response, "invalid_pairing_request")
	}
}

func TestTLSHandshakeMatchesPinnedFingerprint(t *testing.T) {
	fixture := newSecureFixture(t)

	server := httptest.NewUnstartedServer(fixture.handler)
	server.TLS = &tls.Config{Certificates: []tls.Certificate{fixture.cert.TLS}, MinVersion: tls.VersionTLS12}
	server.StartTLS()
	t.Cleanup(server.Close)

	// 模拟手机端的 pinning：跳过链验证，只比对 leaf 证书 DER 的 SHA-256。
	pinned := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{
		InsecureSkipVerify: true,
		VerifyPeerCertificate: func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
			if len(rawCerts) == 0 {
				return fmt.Errorf("no peer certificate")
			}
			if sha256.Sum256(rawCerts[0]) != fixture.cert.Fingerprint {
				return fmt.Errorf("fingerprint mismatch")
			}
			return nil
		},
	}}}
	response, err := pinned.Get(server.URL + Path)
	if err != nil {
		t.Fatalf("pinned request: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (unpaired)", response.StatusCode)
	}

	wrongPin := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{
		InsecureSkipVerify: true,
		VerifyPeerCertificate: func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
			return fmt.Errorf("fingerprint mismatch")
		},
	}}}
	if _, err := wrongPin.Get(server.URL + Path); err == nil {
		t.Fatal("mismatched pin did not fail the handshake")
	}
}
