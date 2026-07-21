package demolan

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/Tomyail/herdr-connect/internal/herdrsource"
)

// EventsPath 是 SSE 端点：集合级（不是 per-agent），不走 agentAction 两段式
// 路径解析，在 ServeHTTP 里单独判断分发。
const EventsPath = Path + "/events"

// sseBroadcastPollInterval 是 broadcaster 轮询源的间隔。取 1 秒与
// snapshotCacheTTL 一致：同一窗口内 broadcaster 的 Snapshot 调用会命中
// handler 共享的那份缓存（生产环境 Serve 注入的是同一个 cachedSnapshot），
// 净 herdr CLI 调用速率不会因为加了 SSE 而升高——这是 #23 放大治理逻辑的
// 直接延续。
const sseBroadcastPollInterval = 1 * time.Second

// sseKeepAliveInterval 是 SSE 连接的心跳间隔。与 broadcaster 轮询独立：
// 即使 broadcaster 长时间没有广播（状态稳定），连接也定期写注释帧，避免
// 中间设备 / 系统把空闲连接当成死连接掐掉。取 15 秒：远短于典型 NAT/代理
// 空闲超时（一般 60s），又不会造成无意义流量。
const sseKeepAliveInterval = 15 * time.Second

// maxStreamsPerDevice 是单个 device 同时打开的 SSE 连接数上限。取 2：
// 留出阶段 3 手机端重连时新旧连接短暂并存的余量（重连先建新再关旧），
// 同时挡住同一 token 被多个 app 实例 / 误用客户端无限开连接。
const maxStreamsPerDevice = 2

// sseEvent 是推给客户端的事件载荷。故意只带 {cursor, online}：
// SSE 通道只是"有变化了，当前状态是什么"的轻量信号，客户端收到后走一次
// 正常 REST GET /v1/demo/agents 拿真实 agent 列表。不在这里塞完整 agent
// 数据（序列化逻辑只有一处，线上乱序/丢事件对这一层无害）。
type sseEvent struct {
	Cursor string `json:"cursor"`
	Online bool   `json:"online"`
}

// —— deviceID context 传递 ——
// secureHandlerWithLimiter 认证成功后把 deviceID 塞进 request.Context()，
// streamEvents 读出来做 per-device 连接计数。用私有 key 类型避免冲突。

type deviceIDContextKey struct{}

func requestWithDeviceID(request *http.Request, deviceID string) *http.Request {
	return request.WithContext(context.WithValue(request.Context(), deviceIDContextKey{}, deviceID))
}

func deviceIDFromRequest(request *http.Request) string {
	if v, ok := request.Context().Value(deviceIDContextKey{}).(string); ok {
		return v
	}
	return ""
}

// —— per-device SSE 并发连接计数 ——
// 与 rate_limit.go 的 token bucket（速率）是不同的东西：这里限的是"同时
// 打开的连接数"，不是"请求频率"。超限返回 429 stream_limit_exceeded。
type streamConnLimiter struct {
	mu     sync.Mutex
	active map[string]int
}

func newStreamConnLimiter() *streamConnLimiter {
	return &streamConnLimiter{active: make(map[string]int)}
}

// acquire 尝试为 deviceID 占一个连接名额，成功返回 true。
func (l *streamConnLimiter) acquire(deviceID string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.active[deviceID] >= maxStreamsPerDevice {
		return false
	}
	l.active[deviceID]++
	return true
}

func (l *streamConnLimiter) release(deviceID string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.active[deviceID] <= 1 {
		delete(l.active, deviceID)
	} else {
		l.active[deviceID]--
	}
}

// —— broadcaster ——

// sseBroadcaster 订阅者计数驱动启停轮询：0 个订阅者时完全不轮询（不产生
// 任何 Snapshot / herdr CLI 调用）；订阅者从 0→1 启动轮询 goroutine，从
// 1→0 取消。每次 tick 调 snapshot 取快照，按广播 key（error/offline/cursor:N）
// 是否变化决定是否推送。
type sseBroadcaster struct {
	snapshot     snapshotFunc // 生产环境即 handler 共享的缓存版本
	pollInterval time.Duration

	mu          sync.Mutex
	subscribers map[chan sseEvent]struct{}
	lastKey     string // 初始 ""，保证首次轮询结果一定触发推送（除非 snapshot 也产生 "" key，不可能）
	cancelPoll  context.CancelFunc
}

func newSSEBroadcaster(snapshot snapshotFunc) *sseBroadcaster {
	return newSSEBroadcasterWithInterval(snapshot, sseBroadcastPollInterval)
}

// newSSEBroadcasterWithInterval 允许注入轮询间隔，测试用（避免 1 秒真实等待）。
func newSSEBroadcasterWithInterval(snapshot snapshotFunc, interval time.Duration) *sseBroadcaster {
	return &sseBroadcaster{
		snapshot:     snapshot,
		pollInterval: interval,
		subscribers:  make(map[chan sseEvent]struct{}),
	}
}

// broadcastKey 把 snapshot 结果映射成"是否需要推送"的判别 key。
// 三态：报错 → "error"；离线 → "offline"；正常 → "cursor:"+cursor。
// 不能只看 cursor：source 掉线时 cursor 不变，但必须推送，否则客户端会在
// 真实故障期间还展示过期的"已连接"数据。
func broadcastKey(snap herdrsource.Snapshot, err error) string {
	if err != nil {
		return "error"
	}
	if !snap.Online {
		return "offline"
	}
	return "cursor:" + snap.Cursor
}

// subscribe 返回一个事件 channel 和取消订阅函数。首个订阅者（0→1）启动轮询
// goroutine。每个新订阅者都会立即收到一帧当前状态（基于当下 snapshot），
// 保证一连上就拿到“当前状态”，不用空等最多一个 pollInterval。
//
// lastKey 维护：首帧推送后同步更新 lastKey，避免 pollLoop 第一拍重复推
// 相同状态。多个订阅者在同一状态窗口内相继 subscribe 时，lastKey 已反映
// 当前状态，首帧会推但 lastKey 不变（状态确实没变），pollLoop 不会重复推。
//
// 每个 subscriber channel buffer=1，合并式发送（发前排空旧值），慢消费者
// 不阻塞 broadcaster、不积压——反正客户端只关心“有没有更新”。
func (b *sseBroadcaster) subscribe() (<-chan sseEvent, func()) {
	ch := make(chan sseEvent, 1)

	// 取当前 snapshot 作为首帧。不在锁内调用（snapshot 可能慢）。
	ctx, cancel := context.WithTimeout(context.Background(), snapshotCallTimeout)
	defer cancel()
	snap, err := b.snapshot(ctx)
	event := sseEvent{Cursor: snap.Cursor, Online: snap.Online && err == nil}
	key := broadcastKey(snap, err)

	b.mu.Lock()
	wasEmpty := len(b.subscribers) == 0
	b.subscribers[ch] = struct{}{}
	if wasEmpty && b.cancelPoll == nil {
		// 0→1：启动轮询 goroutine。lastKey 设为当前 key，避免 pollLoop 第一拍重复推。
		b.lastKey = key
		pollCtx, pollCancel := context.WithCancel(context.Background())
		b.cancelPoll = pollCancel
		b.mu.Unlock()
		go b.pollLoop(pollCtx)
	} else {
		b.mu.Unlock()
	}

	// 新订阅者首帧，直接发。
	sendMerged(ch, event)

	return ch, func() { b.unsubscribe(ch) }
}

func (b *sseBroadcaster) unsubscribe(ch chan sseEvent) {
	b.mu.Lock()
	delete(b.subscribers, ch)
	if len(b.subscribers) == 0 && b.cancelPoll != nil {
		// 1→0：取消轮询 goroutine。
		b.cancelPoll()
		b.cancelPoll = nil
		// 重置 lastKey：下次有新订阅者时首轮询结果一定触发首帧推送，
		// 不受上一轮生命周期残留的状态影响。
		b.lastKey = ""
	}
	b.mu.Unlock()
	// 注意：这里**不** close(ch)。
	//
	// unsubscribe 的唯一调用方是 streamEvents 的 defer，调用者本人在 request.Context()
	// 触发 return 后才走到这里，之后不会再读这个 channel——所以没人依赖 close 来感知
	// 退出。反过来，如果在这里 close，会和 pollOnce 产生竞态：pollOnce 在锁内把订阅者
	// map 拷贝成 slice 后释放锁，然后在锁外逐个 sendMerged；若期间某个订阅者的
	// unsubscribe 先 close 了它的 channel，sendMerged 往已关闭 channel 发送会 panic
	// （Go 里 send-on-closed 是运行时错误，select 的 default 分支拦不住）。
	// 不 close 则 sendMerged 永远安全：channel 留给 GC 在无引用后回收。
}

// subscriberCount 仅供测试断言"订阅者清理后归零"。
func (b *sseBroadcaster) subscriberCount() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.subscribers)
}

// pollLoop 周期性 tick 调 pollOnce。退出条件：ctx 被取消（最后一个订阅者
// unsubscribe 时触发）。
func (b *sseBroadcaster) pollLoop(ctx context.Context) {
	ticker := time.NewTicker(b.pollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			b.pollOnce(ctx)
		}
	}
}

// pollOnce 取一次 snapshot，按广播 key 变化决定是否向所有订阅者推送。
func (b *sseBroadcaster) pollOnce(ctx context.Context) {
	// 用一个独立超时保护：snapshot 生产环境走 cachedSnapshot 已自带 5s
	// callTimeout，这里再加一层防御，避免 snapshot 实现变化时 broadcaster 卡死。
	ctx, cancel := context.WithTimeout(ctx, snapshotCallTimeout)
	defer cancel()

	snap, err := b.snapshot(ctx)
	key := broadcastKey(snap, err)

	b.mu.Lock()
	if key == b.lastKey {
		b.mu.Unlock()
		return
	}
	b.lastKey = key
	// 在锁内拷贝订阅者列表，避免发送时长时间持锁 / 与 subscribe/unsubscribe 交错。
	subs := make([]chan sseEvent, 0, len(b.subscribers))
	for ch := range b.subscribers {
		subs = append(subs, ch)
	}
	b.mu.Unlock()

	// 报错时也构造一个事件？不——报错时 online=false 就是给客户端的信号，
	// 但我们拿不到有效 cursor。给一个 online=false、空 cursor 的事件，客户端
	// 会重新 REST 拉，REST 侧自有 source_unavailable 503 处理。保持事件形状统一。
	event := sseEvent{Cursor: snap.Cursor, Online: snap.Online && err == nil}
	for _, ch := range subs {
		sendMerged(ch, event)
	}
}

// sendMerged 合并式发送：buffer=1 的 channel，发之前先非阻塞排空旧值，
// 再发新值。慢消费者不会阻塞 broadcaster，channel 不会堆积超过 1 个。
func sendMerged(ch chan sseEvent, event sseEvent) {
	select {
	case <-ch: // 排空旧值
	default:
	}
	select {
	case ch <- event:
	default:
		// 极端情况：排空后立刻被并发填入（不应发生，因为只有 pollOnce 发送，
		// 且 pollOnce 串行调用）。drop，反正客户端只关心"有更新"的布尔意义。
	}
}

// —— streamEvents handler ——

// streamEvents 是 SSE 端点 handler。流程：
//  1. 非 GET → 405；
//  2. http.Flusher 断言失败 → 500（防御性）；
//  3. per-device 连接计数 acquire，失败 → 429 stream_limit_exceeded；
//  4. 订阅 broadcaster；
//  5. 覆盖 Content-Type 为 text/event-stream（setCommonHeaders 设的是 json）；
//  6. 主循环：request.Context().Done()（客户端断开）/ events channel / 15s 心跳。
func (h *handler) streamEvents(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		response.Header().Set("Allow", http.MethodGet)
		writeError(response, http.StatusMethodNotAllowed, "method_not_allowed", "events endpoint only accepts GET")
		return
	}

	flusher, ok := response.(http.Flusher)
	if !ok {
		writeError(response, http.StatusInternalServerError, "stream_unsupported", "streaming not supported")
		return
	}

	deviceID := deviceIDFromRequest(request)
	if deviceID == "" || !h.streamLimiter.acquire(deviceID) {
		writeRateLimitedWithCode(response, "stream_limit_exceeded", "too many concurrent event streams for this device")
		return
	}
	defer h.streamLimiter.release(deviceID)

	events, unsubscribe := h.broadcaster.subscribe()
	defer unsubscribe()

	// 覆盖 setCommonHeaders 设的 json Content-Type，换成 SSE。
	header := response.Header()
	header.Set("Content-Type", "text/event-stream")
	header.Set("Cache-Control", "no-store")
	header.Set("Connection", "keep-alive")
	// X-Herdr-Connect-Demo-Version 由 setCommonHeaders 已设，保留。
	response.WriteHeader(http.StatusOK)
	flusher.Flush()

	keepAlive := time.NewTicker(sseKeepAliveInterval)
	defer keepAlive.Stop()

	for {
		select {
		case <-request.Context().Done():
			// 客户端断开，return 触发上面的 defer 清理（release 连接名额 + unsubscribe）。
			return
		case event, ok := <-events:
			if !ok {
				// 防御性分支：broadcaster 不会 close channel（见 unsubscribe 注释），
				// 正常情况下不命中；若未来语义变更导致 channel 被关闭，这里安全退出。
				return
			}
			payload, err := json.Marshal(event)
			if err != nil {
				continue
			}
			// SSE 帧：event 名 + data 行 + 空行结束。
			fmt.Fprintf(response, "event: agents_changed\ndata: %s\n\n", payload)
			flusher.Flush()
		case <-keepAlive.C:
			// 注释帧，防止中间设备掐空闲连接。
			fmt.Fprint(response, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

// writeRateLimitedWithCode 是 writeRateLimited 的可定制 code 变体，用于
// 区分"请求太快"（rate_limited）和"连接开太多"（stream_limit_exceeded）。
func writeRateLimitedWithCode(response http.ResponseWriter, code, message string) {
	response.Header().Set("Retry-After", retryAfterSeconds)
	writeError(response, http.StatusTooManyRequests, code, message)
}
