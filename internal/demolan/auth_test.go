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
	"strconv"
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
		if response.Header().Get("X-Herdr-Connect-Api-Version") == "" {
			t.Fatalf("%s: missing api version header", name)
		}
		if !strings.Contains(response.Body.String(), `"api_version"`) {
			t.Fatalf("%s: missing api_version field: %s", name, response.Body.String())
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
	// 已撤销 token 应返回 "revoked"，区别于未知 token 的 "unauthorized"。
	assertErrorCode(t, response, "revoked")
}

// —— 设备自吊销（issue #52）——
// DELETE /v1/device：已认证设备吊销自己的 token。device 身份从 bearer token
// 反查，客户端不传参；吊销立即生效，原 token 此后对所有受保护端点返回 401
// revoked，与 CLI devices revoke 语义一致。

func authorizedRequest(token string) *http.Request {
	request := httptest.NewRequest(http.MethodGet, Path, nil)
	request.Header.Set("Authorization", "Bearer "+token)
	return request
}

func selfRevokeRequest(token string) *http.Request {
	request := httptest.NewRequest(http.MethodDelete, DevicePath, nil)
	request.Header.Set("Authorization", "Bearer "+token)
	return request
}

func TestSelfRevoke吊销后原Token立即失效并返回revoked语义(t *testing.T) {
	fixture := newSecureFixture(t)
	ctx := context.Background()

	secret, _, err := lanauth.NewPairingSecret(ctx, fixture.database)
	if err != nil {
		t.Fatalf("create pairing secret: %v", err)
	}
	paired := fixture.pair(t, secret, "iPhone")

	// 吊销前：token 可访问受保护端点。
	before := httptest.NewRecorder()
	fixture.handler.ServeHTTP(before, authorizedRequest(paired.Token))
	if before.Code != http.StatusOK {
		t.Fatalf("吊销前状态码 = %d, body = %s", before.Code, before.Body.String())
	}

	// 自吊销：204 No Content。
	revoke := httptest.NewRecorder()
	fixture.handler.ServeHTTP(revoke, selfRevokeRequest(paired.Token))
	if revoke.Code != http.StatusNoContent {
		t.Fatalf("自吊销状态码 = %d, body = %s", revoke.Code, revoke.Body.String())
	}

	// 吊销后：同一 token 对受保护端点（读 + 写各代表一个）立即 401 revoked，
	// 区别于未知 token 的 unauthorized。鉴权在中间件层统一生效。
	for name, request := range map[string]*http.Request{
		"GET agents": authorizedRequest(paired.Token),
		"POST focus": func() *http.Request {
			request := httptest.NewRequest(http.MethodPost, Path+"/term-1/focus", nil)
			request.Header.Set("Authorization", "Bearer "+paired.Token)
			return request
		}(),
	} {
		response := httptest.NewRecorder()
		fixture.handler.ServeHTTP(response, request)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("吊销后 %s 状态码 = %d, want 401", name, response.Code)
		}
		assertErrorCode(t, response, "revoked")
	}
}

func TestSelfRevoke未认证请求遵循既有鉴权错误契约(t *testing.T) {
	fixture := newSecureFixture(t)

	for name, request := range map[string]*http.Request{
		"no token":    selfRevokeRequest(""),
		"wrong token": selfRevokeRequest("bogus"),
	} {
		response := httptest.NewRecorder()
		fixture.handler.ServeHTTP(response, request)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("%s: 状态码 = %d, want 401", name, response.Code)
		}
		assertErrorCode(t, response, "unauthorized")
		// 公共响应头约定：401 也必须携带 api version 标记。
		if response.Header().Get("X-Herdr-Connect-Api-Version") == "" {
			t.Fatalf("%s: missing api version header", name)
		}
		if !strings.Contains(response.Body.String(), `"api_version"`) {
			t.Fatalf("%s: missing api_version field: %s", name, response.Body.String())
		}
	}
}

func TestSelfRevoke已被吊销的Token不能再次自吊销(t *testing.T) {
	// 已被 CLI 吊销的 token 调用自吊销端点：中间件先拒（401 revoked），
	// 不会触到吊销逻辑——自吊销不会把“已吊销”变成成功或 500。
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

	response := httptest.NewRecorder()
	fixture.handler.ServeHTTP(response, selfRevokeRequest(paired.Token))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("已吊销 token 自吊销状态码 = %d, want 401", response.Code)
	}
	assertErrorCode(t, response, "revoked")
}

func TestSelfRevoke只吊销调用方自己不影响其它设备(t *testing.T) {
	fixture := newSecureFixture(t)
	ctx := context.Background()

	firstSecret, _, err := lanauth.NewPairingSecret(ctx, fixture.database)
	if err != nil {
		t.Fatalf("create first pairing secret: %v", err)
	}
	secondSecret, _, err := lanauth.NewPairingSecret(ctx, fixture.database)
	if err != nil {
		t.Fatalf("create second pairing secret: %v", err)
	}
	iphone := fixture.pair(t, firstSecret, "iPhone")
	ipad := fixture.pair(t, secondSecret, "iPad")

	revoke := httptest.NewRecorder()
	fixture.handler.ServeHTTP(revoke, selfRevokeRequest(iphone.Token))
	if revoke.Code != http.StatusNoContent {
		t.Fatalf("自吊销状态码 = %d, body = %s", revoke.Code, revoke.Body.String())
	}

	// 吊销方失效。
	revoked := httptest.NewRecorder()
	fixture.handler.ServeHTTP(revoked, authorizedRequest(iphone.Token))
	if revoked.Code != http.StatusUnauthorized {
		t.Fatalf("吊销方状态码 = %d, want 401", revoked.Code)
	}
	assertErrorCode(t, revoked, "revoked")

	// 其它设备不受影响，token 仍可用。
	other := httptest.NewRecorder()
	fixture.handler.ServeHTTP(other, authorizedRequest(ipad.Token))
	if other.Code != http.StatusOK {
		t.Fatalf("其它设备状态码 = %d, body = %s", other.Code, other.Body.String())
	}
}

func TestSelfRevoke端点只接受DELETE(t *testing.T) {
	fixture := newSecureFixture(t)
	ctx := context.Background()

	secret, _, err := lanauth.NewPairingSecret(ctx, fixture.database)
	if err != nil {
		t.Fatalf("create pairing secret: %v", err)
	}
	paired := fixture.pair(t, secret, "iPhone")

	request := httptest.NewRequest(http.MethodGet, DevicePath, nil)
	request.Header.Set("Authorization", "Bearer "+paired.Token)
	response := httptest.NewRecorder()
	fixture.handler.ServeHTTP(response, request)
	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET 状态码 = %d, want 405", response.Code)
	}
	assertErrorCode(t, response, "method_not_allowed")
	if got := response.Header().Get("Allow"); got != http.MethodDelete {
		t.Fatalf("Allow = %q, want DELETE", got)
	}
	if response.Header().Get("X-Herdr-Connect-Api-Version") == "" {
		t.Fatal("missing api version header")
	}
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

// —— 客户端版本协商（issue #30 阶段A）——
// 机制：请求携带 X-Herdr-Connect-Client-Version 头；缺失放行，低于
// MinSupportedClientVersion 返回 426 client_outdated。检查在最外层（鉴权/
// 限流之前），因此 /v1/pair 与未配对路径都覆盖，且不会被 401 挡住。

func TestClientVersionMissingIsAllowed(t *testing.T) {
	fixture := newSecureFixture(t)
	resp := httptest.NewRecorder()
	fixture.handler.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, Path, nil))
	// 头缺失 = 老式 / curl / 存活探测 → 不因版本被拒，继续走正常鉴权路径 → 401。
	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (missing version header should be allowed through to normal auth)", resp.Code)
	}
	assertErrorCode(t, resp, "unauthorized")
}

func TestClientVersionOutdatedReturns426(t *testing.T) {
	fixture := newSecureFixture(t)
	req := httptest.NewRequest(http.MethodGet, Path, nil)
	req.Header.Set(ClientVersionHeader, "0")
	resp := httptest.NewRecorder()
	fixture.handler.ServeHTTP(resp, req)
	if resp.Code != http.StatusUpgradeRequired {
		t.Fatalf("status = %d, want 426", resp.Code)
	}
	assertErrorCode(t, resp, "client_outdated")
	if got := resp.Header().Get("X-Herdr-Connect-Api-Version"); got == "" {
		t.Fatalf("missing api version header on 426")
	}
	if !strings.Contains(resp.Body.String(), `"api_version"`) {
		t.Fatalf("426 body missing api_version field: %s", resp.Body.String())
	}
}

func TestClientVersionOutdatedIsCheckedBeforeAuth(t *testing.T) {
	// 即使是无 token 的未配对请求，版本过旧也要先于 401 生效——这样旧版客户端
	// 在配对流程里也能收到升级提示，不会误以为只是“没配对”。
	fixture := newSecureFixture(t)
	req := httptest.NewRequest(http.MethodPost, PairPath, strings.NewReader(`{"device_name":"x","secret":"s"}`))
	req.Header.Set(ClientVersionHeader, "0")
	resp := httptest.NewRecorder()
	fixture.handler.ServeHTTP(resp, req)
	if resp.Code != http.StatusUpgradeRequired {
		t.Fatalf("status = %d, want 426 (version check must precede pair/auth)", resp.Code)
	}
	assertErrorCode(t, resp, "client_outdated")
}

func TestClientVersionCurrentIsAllowed(t *testing.T) {
	fixture := newSecureFixture(t)
	req := httptest.NewRequest(http.MethodGet, Path, nil)
	req.Header.Set(ClientVersionHeader, strconv.Itoa(MinSupportedClientVersion))
	resp := httptest.NewRecorder()
	fixture.handler.ServeHTTP(resp, req)
	// 版本达标 → 放行进入鉴权 → 无 token 仍返 401，证明版本检查未拒。
	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (current version should pass through to auth)", resp.Code)
	}
	assertErrorCode(t, resp, "unauthorized")
}

func TestClientVersionMalformedIsRejected(t *testing.T) {
	// 非数字头应被当作不可识别版本拒绝（而非故作“缺失”放行），避免老客户端
	// 用乱填头绕过检查。
	fixture := newSecureFixture(t)
	req := httptest.NewRequest(http.MethodGet, Path, nil)
	req.Header.Set(ClientVersionHeader, "not-a-number")
	resp := httptest.NewRecorder()
	fixture.handler.ServeHTTP(resp, req)
	if resp.Code != http.StatusUpgradeRequired {
		t.Fatalf("status = %d, want 426 (malformed version should be rejected, not treated as missing)", resp.Code)
	}
	assertErrorCode(t, resp, "client_outdated")
}
