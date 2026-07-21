package demolan

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
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

// controllableSnapshot 是可注入返回值、计调用数的 snapshotFunc 测试替身。
type controllableSnapshot struct {
	mu    sync.Mutex
	snap  herdrsource.Snapshot
	err   error
	calls int32
}

func (c *controllableSnapshot) Snapshot(_ context.Context) (herdrsource.Snapshot, error) {
	atomic.AddInt32(&c.calls, 1)
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.snap, c.err
}

func (c *controllableSnapshot) set(snap herdrsource.Snapshot, err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.snap = snap
	c.err = err
}

func (c *controllableSnapshot) count() int32 { return atomic.LoadInt32(&c.calls) }

// controllableSnapshot 也实现 herdrsource.Source 接口的其余方法，只是为了能
// 作为 newHandlerWithSnapshotter 的第一个参数（capability 断言在 SSE 场景不用）。
func (c *controllableSnapshot) Name() string { return "controllable" }
func (c *controllableSnapshot) Changes(context.Context, string) (herdrsource.ChangeBatch, error) {
	return herdrsource.ChangeBatch{}, errors.New("unsupported")
}
func (c *controllableSnapshot) Capabilities(context.Context) (herdrsource.Capabilities, error) {
	return herdrsource.Capabilities{ObserveAgents: true}, nil
}

// —— broadcaster 启停测试：#23 放大治理的直接延续 ——

func TestSSEBroadcasterStopsPollingWhenNoSubscribers(t *testing.T) {
	ctrl := &controllableSnapshot{snap: herdrsource.Snapshot{Online: true, Cursor: "1"}}
	b := newSSEBroadcasterWithInterval(ctrl.Snapshot, 20*time.Millisecond)

	// 没有订阅者时不应有任何轮询调用。
	time.Sleep(60 * time.Millisecond)
	if got := ctrl.count(); got != 0 {
		t.Fatalf("zero subscribers: snapshot calls = %d, want 0", got)
	}

	// 订阅后开始轮询（首帧 out-of-band + tick）。
	events, unsub := b.subscribe()
	before := ctrl.count()
	time.Sleep(80 * time.Millisecond)
	if after := ctrl.count(); after <= before {
		t.Fatalf("after subscribe: snapshot calls did not grow, before=%d after=%d", before, after)
	}
	_ = events

	// 取消订阅后停止轮询。
	unsub()
	before = ctrl.count()
	time.Sleep(80 * time.Millisecond)
	// 允许 +1 容忍 tick 在取消前已 in-flight 的极端竞态。
	if after := ctrl.count(); after > before+1 {
		t.Fatalf("after unsubscribe: snapshot still growing, before=%d after=%d", before, after)
	}
	if got := b.subscriberCount(); got != 0 {
		t.Fatalf("after unsubscribe: subscriber count = %d, want 0", got)
	}
}

func TestSSEBroadcasterDoesNotStartPollTwiceOnConcurrentSubscribe(t *testing.T) {
	ctrl := &controllableSnapshot{snap: herdrsource.Snapshot{Online: true, Cursor: "1"}}
	b := newSSEBroadcasterWithInterval(ctrl.Snapshot, 20*time.Millisecond)

	var wg sync.WaitGroup
	const n = 10
	subs := make([]func(), n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			_, unsub := b.subscribe()
			subs[idx] = unsub
		}(i)
	}
	wg.Wait()

	// 所有订阅者都在，计数 == n；cancelPoll 唯一非 nil（隐含：没有 panic / 泄漏）。
	if got := b.subscriberCount(); got != n {
		t.Fatalf("subscriber count = %d, want %d", got, n)
	}
	for _, unsub := range subs {
		unsub()
	}
	if got := b.subscriberCount(); got != 0 {
		t.Fatalf("after all unsub: subscriber count = %d, want 0", got)
	}
}

// —— cursor / online / error 三态 key 变化才推送 ——

func TestSSEBroadcasterPushesOnlyWhenKeyChanges(t *testing.T) {
	agentA := herdrsource.AgentObservation{SourceID: "term_a", Revision: 1, InteractionState: herdrsource.InteractionWorking}
	ctrl := &controllableSnapshot{snap: herdrsource.Snapshot{Online: true, Cursor: "1", Agents: []herdrsource.AgentObservation{agentA}}}
	b := newSSEBroadcasterWithInterval(ctrl.Snapshot, 5*time.Millisecond)

	events, unsub := b.subscribe()
	defer unsub()

	// 订阅立即触发首帧。
	first := recvEvent(t, events, time.Second)
	if !first.Online {
		t.Fatalf("first frame = %#v", first)
	}

	// agent 列表不变，不应再收到事件。
	if _, ok := tryRecv(events, 60*time.Millisecond); ok {
		t.Fatalf("received event while key unchanged")
	}

	// 关键回归场景：真机上发现的 bug——不相关 agent 的 revision 一直比其它 agent
	// 高时，只用 snap.Cursor（全局 max revision）做判别 key 会被那个不变的高
	// revision agent "压住"，导致其它 agent 真实的 interaction_state 变化
	// 永远不会触发推送。这里让 agentA 的 interaction_state 变化但刻意保持
	// Cursor 字符串不变，断言这依然会推送——证明判别 key 不再依赖 Cursor。
	agentAChanged := herdrsource.AgentObservation{SourceID: "term_a", Revision: 1, InteractionState: herdrsource.InteractionReadyInput}
	ctrl.set(herdrsource.Snapshot{Online: true, Cursor: "1", Agents: []herdrsource.AgentObservation{agentAChanged}}, nil)
	second := recvEvent(t, events, time.Second)
	if second.Cursor != "1" {
		t.Fatalf("second frame cursor = %#v, want 1 (unchanged — the state change is in interaction_state, not cursor)", second)
	}

	// agent 列表不变但 online 变 false → key 变化（offline），必须推送。
	ctrl.set(herdrsource.Snapshot{Online: false, Cursor: "1", Agents: []herdrsource.AgentObservation{agentAChanged}}, nil)
	third := recvEvent(t, events, time.Second)
	if third.Online {
		t.Fatalf("offline frame online should be false, got %#v", third)
	}

	// 报错 → key 变化（error），必须推送。
	ctrl.set(herdrsource.Snapshot{}, errors.New("boom"))
	fourth := recvEvent(t, events, time.Second)
	if fourth.Online {
		t.Fatalf("error frame online should be false, got %#v", fourth)
	}
}

// TestSSEBroadcasterDetectsChangeEvenWhenAnotherAgentHasHigherStableRevision
// 直接复现真机上发现的 bug：真实 Herdr 会话里，如果一个完全不相关的 agent
// （比如另一个 workspace 里一直没变化的会话）恰好 revision 全场最高，早期实现
// 用 snap.Cursor（= 所有 agent revision 的最大值）做变化判别 key，会被这个
// 不变的高 revision agent "钉住"——真正在变化的低 revision agent 的
// interaction_state 反复切换也推不出任何事件，手机端只有手动下拉刷新
// （绕开 SSE 走 REST）才能看到最新状态。
func TestSSEBroadcasterDetectsChangeEvenWhenAnotherAgentHasHigherStableRevision(t *testing.T) {
	dominant := herdrsource.AgentObservation{SourceID: "term_unrelated_high_revision", Revision: 300, InteractionState: herdrsource.InteractionReadyInput}
	watched := herdrsource.AgentObservation{SourceID: "term_watched", Revision: 7, InteractionState: herdrsource.InteractionReadyInput}
	ctrl := &controllableSnapshot{snap: herdrsource.Snapshot{
		Online: true,
		Cursor: "300", // max(300, 7) — dominated by the unrelated agent, exactly like production.
		Agents: []herdrsource.AgentObservation{dominant, watched},
	}}
	b := newSSEBroadcasterWithInterval(ctrl.Snapshot, 5*time.Millisecond)

	events, unsub := b.subscribe()
	defer unsub()
	_ = recvEvent(t, events, time.Second) // initial frame

	// The unrelated dominant agent does NOT change; only the watched agent's
	// interaction_state flips (working now). The aggregate Cursor stays "300"
	// either way (still the max), but this must still broadcast.
	watchedWorking := herdrsource.AgentObservation{SourceID: "term_watched", Revision: 7, InteractionState: herdrsource.InteractionWorking}
	ctrl.set(herdrsource.Snapshot{
		Online: true,
		Cursor: "300",
		Agents: []herdrsource.AgentObservation{dominant, watchedWorking},
	}, nil)
	got := recvEvent(t, events, time.Second)
	if !got.Online {
		t.Fatalf("expected a broadcast when the watched agent's state changed even though Cursor stayed \"300\", got %#v", got)
	}
}

func TestSSEBroadcasterDeliversToMultipleSubscribers(t *testing.T) {
	agentA := herdrsource.AgentObservation{SourceID: "term_a", Revision: 1, InteractionState: herdrsource.InteractionWorking}
	ctrl := &controllableSnapshot{snap: herdrsource.Snapshot{Online: true, Cursor: "1", Agents: []herdrsource.AgentObservation{agentA}}}
	b := newSSEBroadcasterWithInterval(ctrl.Snapshot, 5*time.Millisecond)

	ev1, unsub1 := b.subscribe()
	defer unsub1()
	ev2, unsub2 := b.subscribe()
	defer unsub2()

	// 两个订阅者各自的首帧。
	_ = recvEvent(t, ev1, time.Second)
	_ = recvEvent(t, ev2, time.Second)

	// agent 的可观察状态变化，两个订阅者都应收到（Cursor 字段本身不变，
	// 验证判别 key 来自 agent 列表本身而不是 Cursor）。
	agentAChanged := herdrsource.AgentObservation{SourceID: "term_a", Revision: 1, InteractionState: herdrsource.InteractionBlocked}
	ctrl.set(herdrsource.Snapshot{Online: true, Cursor: "1", Agents: []herdrsource.AgentObservation{agentAChanged}}, nil)
	got1 := recvEvent(t, ev1, time.Second)
	got2 := recvEvent(t, ev2, time.Second)
	if !got1.Online || !got2.Online {
		t.Fatalf("multi-subscriber missed delivery: got1=%#v got2=%#v", got1, got2)
	}
}

// 复现 send-on-closed 竞态场景：多个订阅者在，并发取消其中一个的同时
// 强制触发 pollOnce（它会在锁内拷贝订阅者 slice 后锁外逐个 sendMerged）。
// 历史实现 unsubscribe 末尾 close(ch)，会让 pollOnce 遍历到已 close 的 channel
// 时 sendMerged panic。修复后不 close，这里断言不 panic。
//
// 这个测试不是 100% 确定性复现窗口，但通过高并发 + race + count=20 反复跑
// 能放大触发概率，保护性回归。
func TestSSEBroadcasterConcurrentUnsubscribeAndPollDoesNotPanic(t *testing.T) {
	for iter := 0; iter < 50; iter++ {
		ctrl := &controllableSnapshot{snap: herdrsource.Snapshot{Online: true, Cursor: "1"}}
		b := newSSEBroadcasterWithInterval(ctrl.Snapshot, 50*time.Millisecond)

		const subs = 8
		unsubs := make([]func(), subs)
		for i := 0; i < subs; i++ {
			_, unsubs[i] = b.subscribe()
		}

		var wg sync.WaitGroup
		// 并发取消一半订阅者，同时另一个 goroutine 狂触发 pollOnce（每次轮换 cursor
		// 让 pollOnce 真的走到 sendMerged 那条路径而不是提前 return）。
		wg.Add(2)
		go func() {
			defer wg.Done()
			for i := 0; i < subs/2; i++ {
				unsubs[i]()
			}
		}()
		go func() {
			defer wg.Done()
			for i := 0; i < 100; i++ {
				ctrl.set(herdrsource.Snapshot{Online: true, Cursor: fmt.Sprintf("%d", i)}, nil)
				b.pollOnce(context.Background())
			}
		}()
		wg.Wait()

		// 清理剩余订阅者。
		for i := subs / 2; i < subs; i++ {
			unsubs[i]()
		}
	}
}

// —— streamEvents handler：鉴权、并发连接数、流式响应 ——

type sseFixture struct {
	handler  http.Handler
	database *store.Store
	// broadcaster 暴露出来供断开连接测试观察订阅者计数。
	broadcaster *sseBroadcaster
}

func newSSEFixture(t *testing.T, ctrl *controllableSnapshot) sseFixture {
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
	h := newHandlerWithSnapshotter(ctrl, ctrl.Snapshot).(*handler)
	return sseFixture{
		handler:     secureHandlerWithLimiter(h, database, cert, newRateLimiter()),
		database:    database,
		broadcaster: h.broadcaster,
	}
}

func pairDeviceForSSE(t *testing.T, database *store.Store) string {
	t.Helper()
	secret, _, err := lanauth.NewPairingSecret(context.Background(), database)
	if err != nil {
		t.Fatalf("create pairing secret: %v", err)
	}
	device, ok, err := lanauth.CompletePairing(context.Background(), database, secret, "sse-test")
	if err != nil || !ok {
		t.Fatalf("complete pairing: err=%v ok=%v", err, ok)
	}
	return device.Token
}

func TestSSEEndpointRequiresAuthentication(t *testing.T) {
	ctrl := &controllableSnapshot{snap: herdrsource.Snapshot{Online: true, Cursor: "1"}}
	fixture := newSSEFixture(t, ctrl)

	req := httptest.NewRequest(http.MethodGet, EventsPath, nil)
	resp := httptest.NewRecorder()
	fixture.handler.ServeHTTP(resp, req)
	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("no token status = %d, want 401", resp.Code)
	}
	assertErrorCode(t, resp, "unauthorized")
}

func TestSSEEndpointRejectsNonGET(t *testing.T) {
	ctrl := &controllableSnapshot{snap: herdrsource.Snapshot{Online: true, Cursor: "1"}}
	fixture := newSSEFixture(t, ctrl)
	token := pairDeviceForSSE(t, fixture.database)

	req := httptest.NewRequest(http.MethodPost, EventsPath, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp := httptest.NewRecorder()
	fixture.handler.ServeHTTP(resp, req)
	if resp.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST status = %d, want 405", resp.Code)
	}
	assertErrorCode(t, resp, "method_not_allowed")
}

func TestSSEEndpointLimitsConcurrentStreamsPerDevice(t *testing.T) {
	ctrl := &controllableSnapshot{snap: herdrsource.Snapshot{Online: true, Cursor: "1"}}
	fixture := newSSEFixture(t, ctrl)
	token := pairDeviceForSSE(t, fixture.database)

	server := httptest.NewServer(fixture.handler)
	defer server.Close()

	authHeader := "Bearer " + token
	url := server.URL + EventsPath

	// 开 maxStreamsPerDevice 条连接，都应成功（200 + text/event-stream）。
	conns := make([]*streamConn, 0, maxStreamsPerDevice)
	for i := 0; i < maxStreamsPerDevice; i++ {
		conns = append(conns, openSSEConn(t, url, authHeader))
	}
	// 多开一条应被拒：429 stream_limit_exceeded。
	openSSEConnExpectStatus(t, url, authHeader, http.StatusTooManyRequests, "stream_limit_exceeded")

	for _, c := range conns {
		c.close()
	}
}

func TestSSEEndpointSendsInitialFrame(t *testing.T) {
	ctrl := &controllableSnapshot{snap: herdrsource.Snapshot{Online: true, Cursor: "42"}}
	fixture := newSSEFixture(t, ctrl)
	token := pairDeviceForSSE(t, fixture.database)

	server := httptest.NewServer(fixture.handler)
	defer server.Close()

	conn := openSSEConn(t, server.URL+EventsPath, "Bearer "+token)
	defer conn.close()

	// 首帧应包含 cursor 42 + online true。
	frame := conn.readFrame(time.Second)
	if !strings.Contains(frame, "event: agents_changed") || !strings.Contains(frame, `"cursor":"42"`) || !strings.Contains(frame, `"online":true`) {
		t.Fatalf("initial frame mismatch:\n%s", frame)
	}
}

// 客户端断开后 broadcaster 清理订阅（订阅者计数归零，连接名额释放）。
func TestSSEEndpointCleansUpSubscriberOnClientDisconnect(t *testing.T) {
	ctrl := &controllableSnapshot{snap: herdrsource.Snapshot{Online: true, Cursor: "1"}}
	fixture := newSSEFixture(t, ctrl)
	token := pairDeviceForSSE(t, fixture.database)

	server := httptest.NewServer(fixture.handler)
	defer server.Close()

	conn := openSSEConn(t, server.URL+EventsPath, "Bearer "+token)
	// 读到首帧说明已订阅。
	_ = conn.readFrame(time.Second)
	if got := fixture.broadcaster.subscriberCount(); got != 1 {
		t.Fatalf("after subscribe: subscriber count = %d, want 1", got)
	}

	// 客户端断开。
	conn.close()

	// 等待服务端感知断开（http.Server 检测到读 EOF 触发 ctx.Done → unsubscribe）。
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if fixture.broadcaster.subscriberCount() == 0 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("after client disconnect: subscriber count = %d, want 0", fixture.broadcaster.subscriberCount())
}

// 断开后连接名额也要释放（同一 device 能重新开到上限）。
func TestSSEEndpointReleasesConnectionSlotAfterDisconnect(t *testing.T) {
	ctrl := &controllableSnapshot{snap: herdrsource.Snapshot{Online: true, Cursor: "1"}}
	fixture := newSSEFixture(t, ctrl)
	token := pairDeviceForSSE(t, fixture.database)

	server := httptest.NewServer(fixture.handler)
	defer server.Close()

	url := server.URL + EventsPath
	authHeader := "Bearer " + token

	conn := openSSEConn(t, url, authHeader)
	_ = conn.readFrame(time.Second)
	conn.close()

	// 等名额释放。
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if fixture.broadcaster.subscriberCount() == 0 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	// 重新开 maxStreamsPerDevice 条都应成功。
	conns := make([]*streamConn, 0, maxStreamsPerDevice)
	for i := 0; i < maxStreamsPerDevice; i++ {
		conns = append(conns, openSSEConn(t, url, authHeader))
	}
	for _, c := range conns {
		c.close()
	}
}

// —— helpers ——

func recvEvent(t *testing.T, ch <-chan sseEvent, timeout time.Duration) sseEvent {
	t.Helper()
	e, ok := tryRecv(ch, timeout)
	if !ok {
		t.Fatalf("no event received within %v", timeout)
	}
	return e
}

func tryRecv(ch <-chan sseEvent, timeout time.Duration) (sseEvent, bool) {
	select {
	case e, ok := <-ch:
		if !ok {
			return sseEvent{}, false
		}
		return e, true
	case <-time.After(timeout):
		return sseEvent{}, false
	}
}

// streamConn 包装一条 SSE HTTP 长连接，便于读取帧。
type streamConn struct {
	resp   *http.Response
	reader *bufio.Reader
	cancel context.CancelFunc
}

func openSSEConn(t *testing.T, url, authHeader string) *streamConn {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		cancel()
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Authorization", authHeader)
	transport := &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}
	client := &http.Client{Transport: transport}
	resp, err := client.Do(req)
	if err != nil {
		cancel()
		t.Fatalf("do request: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		body := make([]byte, 512)
		n, _ := resp.Body.Read(body)
		cancel()
		resp.Body.Close()
		t.Fatalf("status = %d, want 200; body=%s", resp.StatusCode, string(body[:n]))
	}
	return &streamConn{resp: resp, reader: bufio.NewReader(resp.Body), cancel: cancel}
}

func openSSEConnExpectStatus(t *testing.T, url, authHeader string, wantStatus int, wantCode string) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		cancel()
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Authorization", authHeader)
	client := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}
	resp, err := client.Do(req)
	if err != nil {
		cancel()
		t.Fatalf("do request: %v", err)
	}
	defer cancel()
	defer resp.Body.Close()
	if resp.StatusCode != wantStatus {
		t.Fatalf("status = %d, want %d", resp.StatusCode, wantStatus)
	}
	var errBody ErrorResponse
	body, _ := io.ReadAll(resp.Body)
	_ = json.Unmarshal(body, &errBody)
	if errBody.Error.Code != wantCode {
		t.Fatalf("error code = %q, want %q; body=%s", errBody.Error.Code, wantCode, string(body))
	}
}

func (c *streamConn) readFrame(timeout time.Duration) string {
	type result struct {
		s  string
		ok bool
	}
	ch := make(chan result, 1)
	go func() {
		var sb strings.Builder
		for {
			line, err := c.reader.ReadString('\n')
			if err != nil {
				ch <- result{"", false}
				return
			}
			sb.WriteString(line)
			if line == "\n" {
				ch <- result{sb.String(), true}
				return
			}
		}
	}()
	select {
	case r := <-ch:
		if !r.ok {
			panic("read frame failed (connection closed)")
		}
		return r.s
	case <-time.After(timeout):
		panic(fmt.Sprintf("read frame timeout after %v", timeout))
	}
}

func (c *streamConn) close() {
	c.cancel()
	if c.resp != nil && c.resp.Body != nil {
		_, _ = io.Copy(io.Discard, c.resp.Body)
		c.resp.Body.Close()
	}
}
