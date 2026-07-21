package demolan

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/Tomyail/herdr-connect/internal/herdrsource"
	"github.com/Tomyail/herdr-connect/internal/lanauth"
	"github.com/Tomyail/herdr-connect/internal/store"
)

const (
	DefaultAddress  = ":9808"
	Path            = "/v1/agents"
	FocusSuffix     = "/focus"
	HistorySuffix   = "/history"
	MessagesSuffix  = "/messages"
	InterruptSuffix = "/interrupt"
	ServiceType     = "_herdr-connect._tcp"
	APIVersion      = 1
	HistoryLines    = 120
	MaxMessageSize  = 4000
)

type Agent struct {
	SourceID         string                       `json:"source_id"`
	DisplayName      string                       `json:"display_name"`
	WorkspaceLabel   string                       `json:"workspace_label,omitempty"`
	TabLabel         string                       `json:"tab_label,omitempty"`
	AgentName        string                       `json:"agent_name,omitempty"`
	Revision         uint64                       `json:"revision"`
	InteractionState herdrsource.InteractionState `json:"interaction_state"`
	TurnOutcome      *herdrsource.TurnOutcome     `json:"turn_outcome,omitempty"`
}

type AgentsResponse struct {
	APIVersion  int       `json:"api_version"`
	SourceName   string    `json:"source_name"`
	SourceOnline bool      `json:"source_online"`
	RefreshedAt  time.Time `json:"refreshed_at"`
	Agents       []Agent   `json:"agents"`
}

type ErrorResponse struct {
	APIVersion int          `json:"api_version"`
	Error       ErrorDetails `json:"error"`
}

type ErrorDetails struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type HistoryResponse struct {
	APIVersion int       `json:"api_version"`
	SourceID    string    `json:"source_id"`
	Text        string    `json:"text"`
	Revision    uint64    `json:"revision"`
	Truncated   bool      `json:"truncated"`
	RefreshedAt time.Time `json:"refreshed_at"`
}

type MessageRequest struct {
	Text string `json:"text"`
}

type handler struct {
	source        herdrsource.Source
	snapshot      snapshotFunc // 取 Snapshot 的回调，默认 = source.Snapshot；Serve 会注入缓存版本
	now           func() time.Time
	broadcaster   *sseBroadcaster   // SSE 状态推送，订阅者计数驱动启停
	streamLimiter *streamConnLimiter // SSE per-device 并发连接数计数
}

func NewHandler(source herdrsource.Source) http.Handler {
	return &handler{
		source:        source,
		snapshot:      source.Snapshot,
		now:           time.Now,
		broadcaster:   newSSEBroadcaster(source.Snapshot),
		streamLimiter: newStreamConnLimiter(),
	}
}

// newHandlerWithSnapshotter 把 "capability 判断用的原始 source" 与
// "Snapshot 调用" 解耦：source 仍传原始值（保证 h.source.(AgentFocuser) 等
// 类型断言反映底层真实能力），snapshot 传缓存版本（合并/降频）。
// 生产入口 Serve 用这个构造函数。broadcaster 复用同一个 snapshot，这样
// SSE 轮询与 REST 请求共享缓存，净 CLI 调用速率不因加 SSE 升高（见
// sseBroadcastPollInterval 注释）。
func newHandlerWithSnapshotter(source herdrsource.Source, snapshot snapshotFunc) http.Handler {
	return &handler{
		source:        source,
		snapshot:      snapshot,
		now:           time.Now,
		broadcaster:   newSSEBroadcaster(snapshot),
		streamLimiter: newStreamConnLimiter(),
	}
}

// setCommonHeaders 统一响应头：鉴权中间件与 pair 端点的错误响应也必须携带
// demo version 标记，daemoncli 的存活探测依赖它（401 也算"服务在跑"）。
func setCommonHeaders(response http.ResponseWriter) {
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.Header().Set("X-Herdr-Connect-Api-Version", fmt.Sprintf("%d", APIVersion))
}

func (h *handler) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	setCommonHeaders(response)

	// SSE 端点是集合级（一段路径），单独分发，不走 agentAction 两段式解析。
	if request.URL.Path == EventsPath {
		h.streamEvents(response, request)
		return
	}

	if sourceID, action, ok := agentAction(request.URL.Path); ok {
		switch action {
		case "focus":
			h.focusAgent(response, request, sourceID)
		case "history":
			h.readHistory(response, request, sourceID)
		case "messages":
			h.sendMessage(response, request, sourceID)
		case "interrupt":
			h.interruptAgent(response, request, sourceID)
		}
		return
	}

	if request.URL.Path != Path {
		writeError(response, http.StatusNotFound, "not_found", "endpoint not found")
		return
	}
	if request.Method != http.MethodGet {
		response.Header().Set("Allow", http.MethodGet)
		writeError(response, http.StatusMethodNotAllowed, "method_not_allowed", "agents endpoint only accepts GET")
		return
	}

	snapshot, err := h.snapshot(request.Context())
	if err != nil || !snapshot.Online {
		writeError(response, http.StatusServiceUnavailable, "source_unavailable", "Herdr source is currently unavailable")
		return
	}

	agents := make([]Agent, 0, len(snapshot.Agents))
	for _, observed := range snapshot.Agents {
		agents = append(agents, Agent{
			SourceID:         observed.SourceID,
			DisplayName:      observed.DisplayName,
			WorkspaceLabel:   observed.WorkspaceLabel,
			TabLabel:         observed.TabLabel,
			AgentName:        observed.AgentName,
			Revision:         observed.Revision,
			InteractionState: observed.InteractionState,
			TurnOutcome:      observed.TurnOutcome,
		})
	}
	writeJSON(response, http.StatusOK, AgentsResponse{
		APIVersion:  APIVersion,
		SourceName:   h.source.Name(),
		SourceOnline: snapshot.Online,
		RefreshedAt:  h.now().UTC(),
		Agents:       agents,
	})
}

func agentAction(path string) (string, string, bool) {
	prefix := Path + "/"
	if !strings.HasPrefix(path, prefix) {
		return "", "", false
	}
	remainder := strings.TrimPrefix(path, prefix)
	parts := strings.Split(remainder, "/")
	if len(parts) != 2 || parts[0] == "" {
		return "", "", false
	}
	action := parts[1]
	if action != strings.TrimPrefix(FocusSuffix, "/") && action != strings.TrimPrefix(HistorySuffix, "/") && action != strings.TrimPrefix(MessagesSuffix, "/") && action != strings.TrimPrefix(InterruptSuffix, "/") {
		return "", "", false
	}
	return parts[0], action, true
}

func (h *handler) focusAgent(response http.ResponseWriter, request *http.Request, sourceID string) {
	if request.Method != http.MethodPost {
		response.Header().Set("Allow", http.MethodPost)
		writeError(response, http.StatusMethodNotAllowed, "method_not_allowed", "focus endpoint only accepts POST")
		return
	}

	snapshot, err := h.snapshot(request.Context())
	if err != nil || !snapshot.Online {
		writeError(response, http.StatusServiceUnavailable, "source_unavailable", "Herdr source is currently unavailable")
		return
	}
	found := false
	for _, agent := range snapshot.Agents {
		if agent.SourceID == sourceID {
			found = true
			break
		}
	}
	if !found {
		writeError(response, http.StatusNotFound, "agent_not_found", "agent no longer exists")
		return
	}
	focuser, ok := h.source.(herdrsource.AgentFocuser)
	if !ok {
		writeError(response, http.StatusNotImplemented, "focus_unsupported", "source does not support focusing agents")
		return
	}
	if err := focuser.FocusAgent(request.Context(), sourceID); err != nil {
		writeError(response, http.StatusBadGateway, "focus_failed", "failed to focus agent")
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

// interruptAgent 照搬 focusAgent 结构：校验 POST → 查 Snapshot 确认 agent 还在 →
// 类型断言 herdrsource.AgentInterrupter，不支持返回 501 interrupt_unsupported →
// 调用 → 204 No Content。
// 注意：取 Snapshot 走 h.snapshot（#23 的缓存包装），capability 断言走
// h.source（原始未包装值），别搞反——否则会重踩 #23 修过的“缓存污染 capability
// 断言”的坑。
func (h *handler) interruptAgent(response http.ResponseWriter, request *http.Request, sourceID string) {
	if request.Method != http.MethodPost {
		response.Header().Set("Allow", http.MethodPost)
		writeError(response, http.StatusMethodNotAllowed, "method_not_allowed", "interrupt endpoint only accepts POST")
		return
	}

	snapshot, err := h.snapshot(request.Context())
	if err != nil || !snapshot.Online {
		writeError(response, http.StatusServiceUnavailable, "source_unavailable", "Herdr source is currently unavailable")
		return
	}
	found := false
	for _, agent := range snapshot.Agents {
		if agent.SourceID == sourceID {
			found = true
			break
		}
	}
	if !found {
		writeError(response, http.StatusNotFound, "agent_not_found", "agent no longer exists")
		return
	}
	interrupter, ok := h.source.(herdrsource.AgentInterrupter)
	if !ok {
		writeError(response, http.StatusNotImplemented, "interrupt_unsupported", "source does not support interrupting agents")
		return
	}
	if err := interrupter.Interrupt(request.Context(), sourceID); err != nil {
		writeError(response, http.StatusBadGateway, "interrupt_failed", "failed to interrupt agent")
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (h *handler) readHistory(response http.ResponseWriter, request *http.Request, sourceID string) {
	if request.Method != http.MethodGet {
		response.Header().Set("Allow", http.MethodGet)
		writeError(response, http.StatusMethodNotAllowed, "method_not_allowed", "history endpoint only accepts GET")
		return
	}
	if !h.agentExists(response, request, sourceID) {
		return
	}
	reader, ok := h.source.(herdrsource.AgentHistoryReader)
	if !ok {
		writeError(response, http.StatusNotImplemented, "history_unsupported", "source does not support reading history")
		return
	}
	history, err := reader.ReadAgentHistory(request.Context(), sourceID, HistoryLines)
	if err != nil {
		writeError(response, http.StatusBadGateway, "history_failed", "failed to read agent history")
		return
	}
	writeJSON(response, http.StatusOK, HistoryResponse{
		APIVersion: APIVersion,
		SourceID:    sourceID,
		Text:        history.Text,
		Revision:    history.Revision,
		Truncated:   history.Truncated,
		RefreshedAt: h.now().UTC(),
	})
}

func (h *handler) sendMessage(response http.ResponseWriter, request *http.Request, sourceID string) {
	if request.Method != http.MethodPost {
		response.Header().Set("Allow", http.MethodPost)
		writeError(response, http.StatusMethodNotAllowed, "method_not_allowed", "messages endpoint only accepts POST")
		return
	}
	if !h.agentExists(response, request, sourceID) {
		return
	}
	request.Body = http.MaxBytesReader(response, request.Body, MaxMessageSize+128)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	var message MessageRequest
	if err := decoder.Decode(&message); err != nil || strings.TrimSpace(message.Text) == "" || len(message.Text) > MaxMessageSize {
		writeError(response, http.StatusBadRequest, "invalid_message", "message must be 1 to 4000 bytes of text")
		return
	}
	sender, ok := h.source.(herdrsource.AgentMessageSender)
	if !ok {
		writeError(response, http.StatusNotImplemented, "send_unsupported", "source does not support sending messages")
		return
	}
	if err := sender.SendAgentMessage(request.Context(), sourceID, message.Text); err != nil {
		writeError(response, http.StatusBadGateway, "send_failed", "failed to send agent message")
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (h *handler) agentExists(response http.ResponseWriter, request *http.Request, sourceID string) bool {
	snapshot, err := h.snapshot(request.Context())
	if err != nil || !snapshot.Online {
		writeError(response, http.StatusServiceUnavailable, "source_unavailable", "Herdr source is currently unavailable")
		return false
	}
	for _, agent := range snapshot.Agents {
		if agent.SourceID == sourceID {
			return true
		}
	}
	writeError(response, http.StatusNotFound, "agent_not_found", "agent no longer exists")
	return false
}

func Serve(ctx context.Context, address string, source herdrsource.Source, database *store.Store, tlsDir string) error {
	if ctx.Err() != nil {
		return nil
	}

	cert, err := lanauth.LoadOrCreateCertificate(tlsDir)
	if err != nil {
		return fmt.Errorf("load LAN TLS identity: %w", err)
	}
	tlsConfig := &tls.Config{Certificates: []tls.Certificate{cert.TLS}, MinVersion: tls.VersionTLS12}
	listener, err := tls.Listen("tcp", address, tlsConfig)
	if err != nil {
		return fmt.Errorf("listen on LAN endpoint: %w", err)
	}
	defer listener.Close()

	port := listener.Addr().(*net.TCPAddr).Port
	instance := "Herdr Connect"
	if hostname, hostnameErr := os.Hostname(); hostnameErr == nil && hostname != "" {
		instance = "Herdr Connect on " + hostname
	}
	bonjour, err := startAdvertisement(ctx, instance, port, []string{
		"path=" + Path,
		fmt.Sprintf("api_version=%d", APIVersion),
		"fp=" + cert.FingerprintBase64(),
	})
	if err != nil {
		return fmt.Errorf("advertise LAN service: %w", err)
	}
	defer bonjour.Shutdown()

	server := &http.Server{Handler: secureHandler(newHandlerWithSnapshotter(source, newCachedSnapshot(source).Snapshot), database, cert), ReadHeaderTimeout: 5 * time.Second}
	serveResult := make(chan error, 1)
	go func() {
		serveResult <- server.Serve(listener)
	}()

	select {
	case err := <-serveResult:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return fmt.Errorf("run LAN endpoint: %w", err)
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			return fmt.Errorf("stop LAN endpoint: %w", err)
		}
		err := <-serveResult
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("stop LAN endpoint: %w", err)
		}
		return nil
	}
}

func writeError(response http.ResponseWriter, status int, code, message string) {
	writeJSON(response, status, ErrorResponse{
		APIVersion: APIVersion,
		Error: ErrorDetails{
			Code:    code,
			Message: message,
		},
	})
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}
