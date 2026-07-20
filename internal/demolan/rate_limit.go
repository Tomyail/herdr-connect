package demolan

import (
	"net"
	"net/http"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// 限流阈值设计理由：
//
// demo-lan 是单台 daemon、少量已配对手机端（典型 1~3 台）的场景。Herdr CLI
// 调用相对昂贵（每次 Snapshot = 2+N 子进程），HTTP 请求又被缓存合并，因此
// 真正打到底层的频率远低于 HTTP 请求频率。限流主要防的是"单个失控 / 恶意
// 已配对客户端"以及"未配对端探测"，而不是正常使用。
//
// 读路径（GET /agents、GET .../history）：每个 device 5 req/s、burst 10。
// 正常手机端轮询 1~3 秒一次，远低于此；burst 10 容纳一次列表 + 多 tab 历史
// 批量加载的瞬时并发。
//
// 写路径（POST .../focus、POST .../messages）：每个 device 1 req/s、burst 3。
// 写操作直接驱动 Herdr CLI / 用户终端，误用代价高（给 agent 发垃圾消息、
// 频繁抢焦点）；正常用户手动操作远达不到 1/s，burst 3 容纳"连发几条"的
// 合理交互，但挡住脚本化刷屏。
//
// per-IP 限流（pair 端点 + 未认证请求）：1 req/s、burst 20。
// - pair：配对前无 token，只能按 IP 限。burst 20 容纳手机端"扫码后几次重试 /
//   多字段校验失败重发"的合理波动；1 req/s 挡住 QR 信息泄露后的暴力试探。
// - 未认证请求（401 路径）：虽然不触发 Snapshot，但无限速率的鉴权失败会
//   消耗 CPU（哈希比对 / DB 查询）。burst 20 容纳手机端启动时的存活探测 +
//   未配对重试；超出后直接 429，避免 CPU 被鉴权循环吃掉。
const (
	readPerDeviceRate  = rate.Limit(5)   // 每秒 5 个 token
	readPerDeviceBurst = 10
	writePerDeviceRate = rate.Limit(1)   // 每秒 1 个 token
	writePerDeviceBurst = 3
	perIPRate          = rate.Limit(1)   // 每秒 1 个 token
	perIPBurst         = 20

	rateLimitedCode    = "rate_limited"
	retryAfterSeconds  = "1"
)

// rateLimiter 维护 per-Device 与 per-IP 的 token bucket 集合。
//
// 内存增长取舍：每个 deviceID / IP 维持一个 *rate.Limiter。配对设备数量有限
// （典型 <10），可控；per-IP 在公网暴露场景才会膨胀——但 demo-lan 监听 LAN，
// 攻击面主要是同一局域网，IP 数量上限是局域网主机数，不会失控。暂不做 LRU
// 淘汰（YAGNI），后续如果 daemon 跨信任域暴露再补。
type rateLimiter struct {
	mu       sync.Mutex
	devices  map[string]*deviceBuckets
	ips      map[string]*rate.Limiter
	now      func() time.Time
}

type deviceBuckets struct {
	read  *rate.Limiter
	write *rate.Limiter
}

func newRateLimiter() *rateLimiter {
	return &rateLimiter{
		devices: make(map[string]*deviceBuckets),
		ips:     make(map[string]*rate.Limiter),
		now:     time.Now,
	}
}

func (l *rateLimiter) deviceBucketsFor(deviceID string) *deviceBuckets {
	l.mu.Lock()
	defer l.mu.Unlock()
	buckets, ok := l.devices[deviceID]
	if !ok {
		buckets = &deviceBuckets{
			read:  rate.NewLimiter(readPerDeviceRate, readPerDeviceBurst),
			write: rate.NewLimiter(writePerDeviceRate, writePerDeviceBurst),
		}
		l.devices[deviceID] = buckets
	}
	return buckets
}

func (l *rateLimiter) ipLimiterFor(ip string) *rate.Limiter {
	l.mu.Lock()
	defer l.mu.Unlock()
	limiter, ok := l.ips[ip]
	if !ok {
		limiter = rate.NewLimiter(perIPRate, perIPBurst)
		l.ips[ip] = limiter
	}
	return limiter
}

// allowDevice 按 deviceID + 操作类型（读/写）判定。
func (l *rateLimiter) allowDevice(deviceID string, isWrite bool) bool {
	buckets := l.deviceBucketsFor(deviceID)
	if isWrite {
		return buckets.write.Allow()
	}
	return buckets.read.Allow()
}

// allowIP 按 IP 判定（pair 端点 + 未认证请求兜底）。
func (l *rateLimiter) allowIP(ip string) bool {
	return l.ipLimiterFor(ip).Allow()
}

// isWriteMethodPath 判定一个已认证请求是否走写阈值。
// POST 视为写（focus / messages），其余（GET agents / history）视为读。
func isWriteRequest(request *http.Request) bool {
	return request.Method == http.MethodPost
}

// clientIP 从 request.RemoteAddr 提取 IP（去掉端口）。httptest.NewRequest
// 产生空 RemoteAddr，回退到 "127.0.0.1"，保证测试可用且行为确定。
func clientIP(request *http.Request) string {
	host, _, err := net.SplitHostPort(request.RemoteAddr)
	if err != nil || host == "" {
		return "127.0.0.1"
	}
	return host
}

// writeRateLimited 写 429 结构化错误 + Retry-After 头。
func writeRateLimited(response http.ResponseWriter) {
	response.Header().Set("Retry-After", retryAfterSeconds)
	writeError(response, http.StatusTooManyRequests, rateLimitedCode, "rate limit exceeded; slow down and retry shortly")
}
