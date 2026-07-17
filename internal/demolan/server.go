package demolan

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/Tomyail/herdr-connect/internal/herdrsource"
)

const (
	DefaultAddress = ":9808"
	Path           = "/v1/demo/agents"
	FocusSuffix    = "/focus"
	HistorySuffix  = "/history"
	MessagesSuffix = "/messages"
	ServiceType    = "_herdr-connect._tcp"
	DemoVersion    = 0
	HistoryLines   = 120
	MaxMessageSize = 4000
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
	DemoVersion  int       `json:"demo_version"`
	SourceName   string    `json:"source_name"`
	SourceOnline bool      `json:"source_online"`
	RefreshedAt  time.Time `json:"refreshed_at"`
	Agents       []Agent   `json:"agents"`
}

type ErrorResponse struct {
	DemoVersion int          `json:"demo_version"`
	Error       ErrorDetails `json:"error"`
}

type ErrorDetails struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type HistoryResponse struct {
	DemoVersion int       `json:"demo_version"`
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
	source herdrsource.Source
	now    func() time.Time
}

func NewHandler(source herdrsource.Source) http.Handler {
	return &handler{source: source, now: time.Now}
}

func (h *handler) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	response.Header().Set("Cache-Control", "no-store")
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.Header().Set("X-Herdr-Connect-Demo-Version", fmt.Sprintf("%d", DemoVersion))

	if sourceID, action, ok := agentAction(request.URL.Path); ok {
		switch action {
		case "focus":
			h.focusAgent(response, request, sourceID)
		case "history":
			h.readHistory(response, request, sourceID)
		case "messages":
			h.sendMessage(response, request, sourceID)
		}
		return
	}

	if request.URL.Path != Path {
		writeError(response, http.StatusNotFound, "not_found", "演示接口不存在")
		return
	}
	if request.Method != http.MethodGet {
		response.Header().Set("Allow", http.MethodGet)
		writeError(response, http.StatusMethodNotAllowed, "method_not_allowed", "演示接口仅接受 GET")
		return
	}

	snapshot, err := h.source.Snapshot(request.Context())
	if err != nil || !snapshot.Online {
		writeError(response, http.StatusServiceUnavailable, "source_unavailable", "Herdr Source 当前不可用")
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
		DemoVersion:  DemoVersion,
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
	if action != strings.TrimPrefix(FocusSuffix, "/") && action != strings.TrimPrefix(HistorySuffix, "/") && action != strings.TrimPrefix(MessagesSuffix, "/") {
		return "", "", false
	}
	return parts[0], action, true
}

func (h *handler) focusAgent(response http.ResponseWriter, request *http.Request, sourceID string) {
	if request.Method != http.MethodPost {
		response.Header().Set("Allow", http.MethodPost)
		writeError(response, http.StatusMethodNotAllowed, "method_not_allowed", "切换 Agent 仅接受 POST")
		return
	}

	snapshot, err := h.source.Snapshot(request.Context())
	if err != nil || !snapshot.Online {
		writeError(response, http.StatusServiceUnavailable, "source_unavailable", "Herdr Source 当前不可用")
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
		writeError(response, http.StatusNotFound, "agent_not_found", "Agent 已不存在")
		return
	}
	focuser, ok := h.source.(herdrsource.AgentFocuser)
	if !ok {
		writeError(response, http.StatusNotImplemented, "focus_unsupported", "当前来源不支持切换 Agent")
		return
	}
	if err := focuser.FocusAgent(request.Context(), sourceID); err != nil {
		writeError(response, http.StatusBadGateway, "focus_failed", "切换 Agent 失败")
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (h *handler) readHistory(response http.ResponseWriter, request *http.Request, sourceID string) {
	if request.Method != http.MethodGet {
		response.Header().Set("Allow", http.MethodGet)
		writeError(response, http.StatusMethodNotAllowed, "method_not_allowed", "读取历史仅接受 GET")
		return
	}
	if !h.agentExists(response, request, sourceID) {
		return
	}
	reader, ok := h.source.(herdrsource.AgentHistoryReader)
	if !ok {
		writeError(response, http.StatusNotImplemented, "history_unsupported", "当前来源不支持读取历史")
		return
	}
	history, err := reader.ReadAgentHistory(request.Context(), sourceID, HistoryLines)
	if err != nil {
		writeError(response, http.StatusBadGateway, "history_failed", "读取 Agent 历史失败")
		return
	}
	writeJSON(response, http.StatusOK, HistoryResponse{
		DemoVersion: DemoVersion,
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
		writeError(response, http.StatusMethodNotAllowed, "method_not_allowed", "发送消息仅接受 POST")
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
		writeError(response, http.StatusBadRequest, "invalid_message", "消息必须是 1 到 4000 字节的文本")
		return
	}
	sender, ok := h.source.(herdrsource.AgentMessageSender)
	if !ok {
		writeError(response, http.StatusNotImplemented, "send_unsupported", "当前来源不支持发送消息")
		return
	}
	if err := sender.SendAgentMessage(request.Context(), sourceID, message.Text); err != nil {
		writeError(response, http.StatusBadGateway, "send_failed", "发送 Agent 消息失败")
		return
	}
	response.WriteHeader(http.StatusNoContent)
}

func (h *handler) agentExists(response http.ResponseWriter, request *http.Request, sourceID string) bool {
	snapshot, err := h.source.Snapshot(request.Context())
	if err != nil || !snapshot.Online {
		writeError(response, http.StatusServiceUnavailable, "source_unavailable", "Herdr Source 当前不可用")
		return false
	}
	for _, agent := range snapshot.Agents {
		if agent.SourceID == sourceID {
			return true
		}
	}
	writeError(response, http.StatusNotFound, "agent_not_found", "Agent 已不存在")
	return false
}

func Serve(ctx context.Context, address string, source herdrsource.Source) error {
	if ctx.Err() != nil {
		return nil
	}

	listener, err := net.Listen("tcp", address)
	if err != nil {
		return fmt.Errorf("监听演示接口: %w", err)
	}
	defer listener.Close()

	port := listener.Addr().(*net.TCPAddr).Port
	instance := "Herdr Connect Demo"
	if hostname, hostnameErr := os.Hostname(); hostnameErr == nil && hostname != "" {
		instance = "Herdr Connect Demo on " + hostname
	}
	bonjour, err := startAdvertisement(ctx, instance, port, []string{
		"path=" + Path,
		fmt.Sprintf("demo_version=%d", DemoVersion),
	})
	if err != nil {
		return fmt.Errorf("广播演示服务: %w", err)
	}
	defer bonjour.Shutdown()

	server := &http.Server{Handler: NewHandler(source), ReadHeaderTimeout: 5 * time.Second}
	serveResult := make(chan error, 1)
	go func() {
		serveResult <- server.Serve(listener)
	}()

	select {
	case err := <-serveResult:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return fmt.Errorf("运行演示接口: %w", err)
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			return fmt.Errorf("停止演示接口: %w", err)
		}
		err := <-serveResult
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("停止演示接口: %w", err)
		}
		return nil
	}
}

func writeError(response http.ResponseWriter, status int, code, message string) {
	writeJSON(response, status, ErrorResponse{
		DemoVersion: DemoVersion,
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
