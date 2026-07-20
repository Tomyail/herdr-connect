package demolan

import (
	"context"
	"sync"
	"time"

	"github.com/Tomyail/herdr-connect/internal/herdrsource"
	"golang.org/x/sync/singleflight"
)

// snapshotCacheTTL 是 Snapshot 缓存有效期。
//
// 取 1 秒：demo-lan 场景下手机端典型轮询间隔是 1~3 秒，缓存 1 秒能把
// "短时间大量请求 / 并发请求" 合并成一次底层 Herdr CLI 调用，同时不会让
// 客户端感知到明显延迟（< 单次轮询间隔）。TTL 过长会让 source_online:false
// 或错误状态被掩盖太久，让一次瞬时故障看起来持续更久；TTL 过短则失去合并意义。
const snapshotCacheTTL = 1 * time.Second

// snapshotCallTimeout 是单次底层 Snapshot() 调用的超时上限。
//
// Snapshot 内部会 spawn 2+N 个 herdr 子进程（agent list / workspace list /
// 每个 workspace 一次 tab list）。给 5 秒上限：单个子进程正常 <200ms，
// 2+N 次串行调用在合理 N 下 <2s；留足余量，同时避免 herdr CLI 卡住时
// 进程无限堆积。
const snapshotCallTimeout = 5 * time.Second

// snapshotFunc 是 handler 用来取 Snapshot 的回调类型。它存在是为了让
// handler.source（用于 capability 类型断言）与 Snapshot 调用（可走缓存）
// 解耦——见 newHandlerWithSnapshotter。
type snapshotFunc func(ctx context.Context) (herdrsource.Snapshot, error)

// cachedSnapshot 只负责 Snapshot 这一个方法的短 TTL 缓存 + singleflight 合并。
//
// 设计取舍：它**不**实现 herdrsource.Source 全部接口，也**不**透传写侧
// 可选能力（FocusAgent / ReadAgentHistory / SendAgentMessage）。原因：
// handler 用类型断言 `h.source.(herdrsource.AgentFocuser)` 判断底层真实
// 能力，如果 cachedSource 自己也声明这些方法，断言会永远为 true，让
// "不支持"的 501 路径退化成"假装支持"的 502。因此 cachedSnapshot 只暴露
// 一个 Snapshot(ctx) 方法，handler 通过 snapshotFunc 字段引用它，
// capability 断言仍走原始未包装的 source。
//
// 缓存语义（验收标准：source_online:false 与错误不被缓存放大或掩盖）：
//   - 成功结果、离线结果（Online==false）、错误结果统一用 snapshotCacheTTL；
//   - 不给错误更长缓存（避免把瞬时故障"放大"成持续更久的故障）；
//   - TTL 到期后必定重新发起一次真实调用，不会无限期用旧值掩盖新发生的故障。
type cachedSnapshot struct {
	inner herdrsource.Source // 仅用其 Snapshot

	group singleflight.Group

	mu           sync.Mutex
	cached       *snapshotCacheEntry
	cachedAt     time.Time
	callTimeout  time.Duration // 单次底层调用超时，默认 snapshotCallTimeout；测试可注入
	now          func() time.Time
}

type snapshotCacheEntry struct {
	snapshot herdrsource.Snapshot
	err      error
}

// newCachedSnapshot 用默认时钟包装 inner。
func newCachedSnapshot(inner herdrsource.Source) *cachedSnapshot {
	return &cachedSnapshot{inner: inner, now: time.Now, callTimeout: snapshotCallTimeout}
}

// snapshotKey 是 singleflight 的合并 key。整个 daemon 只有一个 source、
// 一个 daemon 实例，无需按参数分片。
const snapshotKey = "snapshot"

// Snapshot 优先返回 TTL 内的缓存结果（无论成功/离线/错误）；cache miss 时
// 用 singleflight 合并并发请求为一次底层调用，底层调用包在
// callTimeout 超时的 context 里。
func (c *cachedSnapshot) Snapshot(ctx context.Context) (herdrsource.Snapshot, error) {
	if entry, ok := c.freshCache(); ok {
		return entry.snapshot, entry.err
	}

	v, _, _ := c.group.Do(snapshotKey, func() (any, error) {
		// double-check：持有 singleflight 锁期间可能已有并发调用填好缓存。
		if entry, ok := c.freshCache(); ok {
			return cacheResult{entry: entry}, nil
		}

		callCtx, cancel := context.WithTimeout(ctx, c.callTimeout)
		defer cancel()
		snap, snapErr := c.inner.Snapshot(callCtx)

		entry := &snapshotCacheEntry{snapshot: snap, err: snapErr}
		c.mu.Lock()
		c.cached = entry
		c.cachedAt = c.now()
		c.mu.Unlock()
		return cacheResult{entry: entry}, nil
	})
	result, ok := v.(cacheResult)
	if !ok {
		// 理论上不会到达：singleflight 回调始终返回 cacheResult。
		return herdrsource.Snapshot{}, context.Canceled
	}
	return result.entry.snapshot, result.entry.err
}

// freshCache 返回 TTL 内的缓存条目（成功/离线/错误都算），TTL 过期或无缓存
// 返回 ok=false。
func (c *cachedSnapshot) freshCache() (*snapshotCacheEntry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cached == nil || c.now().Sub(c.cachedAt) >= snapshotCacheTTL {
		return nil, false
	}
	entry := *c.cached
	return &entry, true
}

// cacheResult 是 singleflight 回调的返回载体，把 snapshot + err 一起带出来。
type cacheResult struct {
	entry *snapshotCacheEntry
}
