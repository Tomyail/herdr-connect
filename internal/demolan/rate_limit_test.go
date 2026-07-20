package demolan

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"io"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Tomyail/herdr-connect/internal/herdrsource"
	"github.com/Tomyail/herdr-connect/internal/lanauth"
	"github.com/Tomyail/herdr-connect/internal/store"
)

// countingSource 是并发安全的 Snapshot 计数 fake，用于验证缓存合并行为。
type countingSource struct {
	mu             sync.Mutex
	calls          int32
	snapshot       herdrsource.Snapshot
	err            error
	delay          time.Duration // 每次 Snapshot 阻塞时长，用于测试并发合并
	ctxCancelledAt chan struct{} // 关闭表示观测到 ctx 取消（用于超时测试）
}

func (s *countingSource) Name() string { return "counting" }

func (s *countingSource) Snapshot(ctx context.Context) (herdrsource.Snapshot, error) {
	atomic.AddInt32(&s.calls, 1)
	if s.delay > 0 {
		select {
		case <-time.After(s.delay):
		case <-ctx.Done():
			if s.ctxCancelledAt != nil {
				close(s.ctxCancelledAt)
			}
			return herdrsource.Snapshot{}, ctx.Err()
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.snapshot, s.err
}

func (s *countingSource) Changes(context.Context, string) (herdrsource.ChangeBatch, error) {
	return herdrsource.ChangeBatch{}, errors.New("unsupported")
}
func (s *countingSource) Capabilities(context.Context) (herdrsource.Capabilities, error) {
	return herdrsource.Capabilities{ObserveAgents: true}, nil
}
func (s *countingSource) count() int32 { return atomic.LoadInt32(&s.calls) }

// —— Snapshot 缓存 + singleflight 合并 ——

func TestCachedSource高并发下底层Snapshot只被调用一两次(t *testing.T) {
	source := &countingSource{snapshot: herdrsource.Snapshot{
		Online: true,
		Agents: []herdrsource.AgentObservation{{SourceID: "a1"}},
	}}
	cached := newCachedSnapshot(source)
	handler := newHandlerWithSnapshotter(source, cached.Snapshot)

	const concurrency = 50
	var wg sync.WaitGroup
	start := make(chan struct{})
	results := make([]int, concurrency)
	var resultsMu sync.Mutex

	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-start
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, Path, nil))
			resultsMu.Lock()
			results[idx] = response.Code
			resultsMu.Unlock()
		}(i)
	}
	close(start)
	wg.Wait()

	for i, code := range results {
		if code != http.StatusOK {
			t.Fatalf("goroutine %d status = %d", i, code)
		}
	}
	// singleflight + 1s TTL：50 个并发请求应该只触发 1 次底层调用
	// （允许 ≤2 容忍极端竞态，但绝不应该接近 50）。
	if got := source.count(); got > 2 {
		t.Fatalf("底层 Snapshot 调用次数 = %d，期望 ≤2（缓存合并生效）", got)
	}
}

func TestCachedSourceTTL窗口内多次请求命中缓存(t *testing.T) {
	source := &countingSource{snapshot: herdrsource.Snapshot{Online: true}}
	cached := newCachedSnapshot(source)
	handler := newHandlerWithSnapshotter(source, cached.Snapshot)

	for i := 0; i < 5; i++ {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, Path, nil))
		if response.Code != http.StatusOK {
			t.Fatalf("第 %d 次状态码 = %d", i, response.Code)
		}
	}
	if got := source.count(); got != 1 {
		t.Fatalf("TTL 窗口内 5 次请求应只触发 1 次底层调用，实际 = %d", got)
	}
}

func TestCachedSource错误结果也用同一TTL不无限重打(t *testing.T) {
	boom := errors.New("boom")
	source := &countingSource{err: boom}
	cached := newCachedSnapshot(source)
	handler := newHandlerWithSnapshotter(source, cached.Snapshot)

	// TTL 窗口内连发 10 次请求，底层应该只被打 1 次（错误被缓存）。
	for i := 0; i < 10; i++ {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, Path, nil))
		if response.Code != http.StatusServiceUnavailable {
			t.Fatalf("第 %d 次状态码 = %d", i, response.Code)
		}
		assertErrorCode(t, response, "source_unavailable")
	}
	if got := source.count(); got != 1 {
		t.Fatalf("错误结果应在 TTL 内被缓存，底层应只调用 1 次，实际 = %d", got)
	}
}

func TestCachedSourceTTL到期后重新调用能感知恢复(t *testing.T) {
	source := &countingSource{err: errors.New("transient")}
	cached := newCachedSnapshot(source)
	cached.now = fakeClock(t)
	handler := newHandlerWithSnapshotter(source, cached.Snapshot)

	// 第一次：底层返回 err，被缓存。
	resp1 := httptest.NewRecorder()
	handler.ServeHTTP(resp1, httptest.NewRequest(http.MethodGet, Path, nil))
	if resp1.Code != http.StatusServiceUnavailable {
		t.Fatalf("第一次状态码 = %d", resp1.Code)
	}

	// 推进时钟超过 TTL，并把底层改成在线。
	cached.now = func() time.Time { return time.Now().Add(snapshotCacheTTL + time.Second) }
	source.mu.Lock()
	source.err = nil
	source.snapshot = herdrsource.Snapshot{Online: true}
	source.mu.Unlock()

	resp2 := httptest.NewRecorder()
	handler.ServeHTTP(resp2, httptest.NewRequest(http.MethodGet, Path, nil))
	if resp2.Code != http.StatusOK {
		t.Fatalf("TTL 过期后应重新调用并看到恢复，状态码 = %d，body=%s", resp2.Code, resp2.Body.String())
	}
}

func TestCachedSource底层调用带超时且ctx会被取消(t *testing.T) {
	cancelled := make(chan struct{})
	source := &countingSource{
		delay:          200 * time.Millisecond,
		ctxCancelledAt: cancelled,
	}
	cached := newCachedSnapshot(source)
	cached.callTimeout = 50 * time.Millisecond // 注入短超时
	handler := newHandlerWithSnapshotter(source, cached.Snapshot)

	done := make(chan struct{})
	go func() {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, Path, nil))
		close(done)
	}()

	select {
	case <-cancelled:
		// 预期：callTimeout 之后 context 被取消，底层 Snapshot 观察到。
	case <-time.After(time.Second):
		t.Fatal("等待 context 取消超时，callTimeout 未生效")
	}
	<-done
}

// fakeClock 返回一个固定时刻的时钟函数，便于"推进 TTL"测试。
func fakeClock(t *testing.T) func() time.Time {
	t.Helper()
	base := time.Now()
	return func() time.Time { return base }
}

// —— 限流 ——

type limiterFixture struct {
	handler  http.Handler
	database *store.Store
	limiter  *rateLimiter
}

func newLimiterFixture(t *testing.T) limiterFixture {
	t.Helper()
	database, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "daemon.db"))
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	source := &countingSource{snapshot: herdrsource.Snapshot{
		Online: true,
		Agents: []herdrsource.AgentObservation{{SourceID: "a1"}},
	}}
	cert, err := lanauth.LoadOrCreateCertificate(t.TempDir())
	if err != nil {
		t.Fatalf("create certificate: %v", err)
	}
	limiter := newRateLimiter()
	handler := secureHandlerWithLimiter(newHandlerWithSnapshotter(source, newCachedSnapshot(source).Snapshot), database, cert, limiter)
	return limiterFixture{handler: handler, database: database, limiter: limiter}
}

func (f limiterFixture) pairDevice(t *testing.T, name string) string {
	t.Helper()
	secret, _, err := lanauth.NewPairingSecret(context.Background(), f.database)
	if err != nil {
		t.Fatalf("create pairing secret: %v", err)
	}
	body := fmt.Sprintf(`{"device_name":%q,"secret":%q}`, name, secret)
	resp := httptest.NewRecorder()
	f.handler.ServeHTTP(resp, httptest.NewRequest(http.MethodPost, PairPath, strings.NewReader(body)))
	if resp.Code != http.StatusOK {
		t.Fatalf("pair status = %d, body = %s", resp.Code, resp.Body.String())
	}
	var pairResp PairResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &pairResp); err != nil {
		t.Fatalf("decode pair response: %v", err)
	}
	return pairResp.Token
}

func authorizedGet(handler http.Handler, token, path string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)
	return resp
}

func authorizedPost(handler http.Handler, token, path string, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)
	return resp
}

func TestRateLimit读路径达到阈值后返回429(t *testing.T) {
	fixture := newLimiterFixture(t)
	token := fixture.pairDevice(t, "iPhone")

	limited := 0
	// 读 burst=10：前若干请求 OK，之后开始 429。
	for i := 0; i < readPerDeviceBurst+10; i++ {
		resp := authorizedGet(fixture.handler, token, Path)
		if resp.Code == http.StatusTooManyRequests {
			limited++
			assertErrorCode(t, resp, rateLimitedCode)
			if resp.Header().Get("Retry-After") == "" {
				t.Fatalf("429 缺少 Retry-After 头")
			}
		}
	}
	if limited == 0 {
		t.Fatalf("读路径超出阈值后应出现 429，实际一次都没限流")
	}
}

func TestRateLimit写路径阈值比读严(t *testing.T) {
	fixture := newLimiterFixture(t)
	token := fixture.pairDevice(t, "iPhone")

	limitedWrites := 0
	// 写 burst=3, rate=1/s：连续发 10 条消息。
	for i := 0; i < 10; i++ {
		resp := authorizedPost(fixture.handler, token, Path+"/a1/messages", `{"text":"hi"}`)
		if resp.Code == http.StatusTooManyRequests {
			limitedWrites++
		}
	}
	if limitedWrites == 0 {
		t.Fatalf("写路径应被限流，实际一次都没限流")
	}

	// 重新 pair 一个设备做读路径对照（避免共享 limiter 状态）。
	token2 := fixture.pairDevice(t, "iPad")
	limitedReads := 0
	for i := 0; i < readPerDeviceBurst+5; i++ {
		resp := authorizedGet(fixture.handler, token2, Path)
		if resp.Code == http.StatusTooManyRequests {
			limitedReads++
		}
	}
	// 写阈值更严：同样请求量下写被限流的次数应明显多于读被限流次数。
	// （写 burst=3 发 10 个 → 限 7；读 burst=10 发 15 个 → 限 5。写 > 读。）
	if limitedWrites <= limitedReads {
		t.Fatalf("写阈值应比读严：写被限 %d 次，读被限 %d 次", limitedWrites, limitedReads)
	}
}

func TestRateLimit不同设备互不影响(t *testing.T) {
	fixture := newLimiterFixture(t)
	tokenA := fixture.pairDevice(t, "A")
	tokenB := fixture.pairDevice(t, "B")

	// 把 A 的读额度打满。
	for i := 0; i < readPerDeviceBurst+5; i++ {
		authorizedGet(fixture.handler, tokenA, Path)
	}
	// A 现在被限流。
	respA := authorizedGet(fixture.handler, tokenA, Path)
	if respA.Code != http.StatusTooManyRequests {
		t.Fatalf("A 应被限流，状态码 = %d", respA.Code)
	}
	// B 不受影响。
	respB := authorizedGet(fixture.handler, tokenB, Path)
	if respB.Code != http.StatusOK {
		t.Fatalf("B 不应受 A 限流影响，状态码 = %d，body=%s", respB.Code, respB.Body.String())
	}
}

func TestRateLimit未认证请求走perIP限流(t *testing.T) {
	fixture := newLimiterFixture(t)

	limited := 0
	// per-IP burst=20：打超过 burst 数量的无 token 请求。
	for i := 0; i < perIPBurst+10; i++ {
		req := httptest.NewRequest(http.MethodGet, Path, nil)
		resp := httptest.NewRecorder()
		fixture.handler.ServeHTTP(resp, req)
		if resp.Code == http.StatusTooManyRequests {
			limited++
			assertErrorCode(t, resp, rateLimitedCode)
		} else if resp.Code != http.StatusUnauthorized {
			t.Fatalf("未超额前应是 401，得到 %d", resp.Code)
		}
	}
	if limited == 0 {
		t.Fatalf("未认证请求超出 per-IP 阈值后应返回 429，实际一次都没限流")
	}
}

func TestRateLimitPair端点走perIP限流(t *testing.T) {
	fixture := newLimiterFixture(t)

	limited := 0
	// 故意发一堆无效 pair 请求（body 合法但 secret 不存在），触发 per-IP 限流。
	body := `{"device_name":"x","secret":"nope"}`
	for i := 0; i < perIPBurst+10; i++ {
		resp := httptest.NewRecorder()
		fixture.handler.ServeHTTP(resp, httptest.NewRequest(http.MethodPost, PairPath, strings.NewReader(body)))
		if resp.Code == http.StatusTooManyRequests {
			limited++
		}
	}
	if limited == 0 {
		t.Fatalf("pair 端点超出 per-IP 阈值后应返回 429，实际一次都没限流")
	}
}

// —— 回归测试：缓存包装不得让 capability 类型断言失真 ——
//
// 历史 bug：cachedSource 曾实现整个 herdrsource.Source + 透传 FocusAgent
// 等方法，导致 handler 里 `h.source.(herdrsource.AgentFocuser)` 永远为 true，
// 把 "source 不支持 focus" 的 501 focus_unsupported 路径退化成 "假装支持"
// 的 502 focus_failed。internal/herdrsource/fake.go 的 *Fake 就不实现写侧
// 三个方法，所以这个 bug 在 `--source fake demo-lan` 下当前就会触发。
//
// 修复后：cachedSnapshot 只暴露 Snapshot，capability 断言走原始 source，
// 不支持的能力必须继续返回 501 + *_unsupported。

// observeOnlySource 只实现 herdrsource.Source，不实现任何写侧可选接口，
// 模拟 *herdrsource.Fake 的能力形状。
type observeOnlySource struct {
	sequenceSource // 复用 Snapshot/fake 行为
}

func TestCapability断言不受缓存装饰影响_不支持的写能力返回501(t *testing.T) {
	source := &observeOnlySource{sequenceSource: sequenceSource{snapshots: []herdrsource.Snapshot{
		{Online: true, Agents: []herdrsource.AgentObservation{{SourceID: "a1"}}},
	}}}

	// 关键：用 newHandlerWithSnapshotter 注入缓存 snapshot，但 source 仍是
	// 原始未包装值——这是生产 Serve() 的真实路径。
	cache := newCachedSnapshot(source)
	handler := newHandlerWithSnapshotter(source, cache.Snapshot)

	for name, tc := range map[string]struct {
		method string
		path   string
		body   string
		want   string
	}{
		"focus":    {http.MethodPost, Path + "/a1/focus", "", "focus_unsupported"},
		"history":  {http.MethodGet, Path + "/a1/history", "", "history_unsupported"},
		"messages": {http.MethodPost, Path + "/a1/messages", `{"text":"hi"}`, "send_unsupported"},
	} {
		resp := httptest.NewRecorder()
		var body io.Reader
		if tc.body != "" {
			body = strings.NewReader(tc.body)
		}
		req := httptest.NewRequest(tc.method, tc.path, body)
		handler.ServeHTTP(resp, req)
		if resp.Code != http.StatusNotImplemented {
			t.Fatalf("%s: 状态码 = %d，期望 501（capability 断言被缓存污染会变 502）", name, resp.Code)
		}
		assertErrorCode(t, resp, tc.want)
	}
}

// 对照：源实现了写能力时，缓存路径下仍能正常调用（不误伤 501）。
func TestCapability断言源支持写能力时缓存路径仍可正常写入(t *testing.T) {
	source := &focusableSource{sequenceSource: sequenceSource{snapshots: []herdrsource.Snapshot{
		{Online: true, Agents: []herdrsource.AgentObservation{{SourceID: "a1"}}},
	}}}
	cache := newCachedSnapshot(source)
	handler := newHandlerWithSnapshotter(source, cache.Snapshot)

	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, httptest.NewRequest(http.MethodPost, Path+"/a1/focus", nil))
	if resp.Code != http.StatusNoContent {
		t.Fatalf("focus 状态码 = %d，body=%s", resp.Code, resp.Body.String())
	}
	if source.focused != "a1" {
		t.Fatalf("focused = %q", source.focused)
	}
}
