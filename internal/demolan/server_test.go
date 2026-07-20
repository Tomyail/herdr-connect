package demolan

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Tomyail/herdr-connect/internal/herdrsource"
)

func TestAgentsHandler每次读取当前Snapshot并只返回演示字段(t *testing.T) {
	outcome := herdrsource.OutcomeSucceeded
	source := &sequenceSource{snapshots: []herdrsource.Snapshot{
		{Online: true, Agents: []herdrsource.AgentObservation{{
			SourceID: "agent-1", DisplayName: "Agent 一", TurnID: "不可暴露的 turn", Revision: 7,
			WorkspaceLabel: "herdr-connect", TabLabel: "connect-shell", AgentName: "codex",
			InteractionState: herdrsource.InteractionWorking,
		}}},
		{Online: true, Agents: []herdrsource.AgentObservation{{
			SourceID: "agent-1", DisplayName: "Agent 一", TurnID: "仍不可暴露", Revision: 8,
			InteractionState: herdrsource.InteractionUnknown, TurnOutcome: &outcome,
		}}},
	}}
	handler := NewHandler(source).(*handler)
	handler.now = func() time.Time { return time.Date(2026, 7, 16, 8, 30, 0, 0, time.FixedZone("CST", 8*60*60)) }

	for requestNumber, wantRevision := range []uint64{7, 8} {
		request := httptest.NewRequest(http.MethodGet, Path, nil)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)

		if response.Code != http.StatusOK {
			t.Fatalf("第 %d 次状态码 = %d, body = %s", requestNumber+1, response.Code, response.Body.String())
		}
		if got := response.Header().Get("Cache-Control"); got != "no-store" {
			t.Fatalf("Cache-Control = %q", got)
		}
		if strings.Contains(response.Body.String(), "turn_id") || strings.Contains(response.Body.String(), "不可暴露") {
			t.Fatalf("响应包含非契约字段: %s", response.Body.String())
		}
		var body AgentsResponse
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatalf("解析响应: %v", err)
		}
		if body.DemoVersion != 0 || body.SourceName != "测试来源" || !body.SourceOnline {
			t.Fatalf("来源元数据 = %#v", body)
		}
		if got := body.RefreshedAt.Format(time.RFC3339); got != "2026-07-16T00:30:00Z" {
			t.Fatalf("refreshed_at = %q", got)
		}
		if len(body.Agents) != 1 || body.Agents[0].Revision != wantRevision {
			t.Fatalf("第 %d 次 agents = %#v", requestNumber+1, body.Agents)
		}
		if requestNumber == 0 && (body.Agents[0].WorkspaceLabel != "herdr-connect" || body.Agents[0].TabLabel != "connect-shell" || body.Agents[0].AgentName != "codex") {
			t.Fatalf("结构化 Agent 名称 = %#v", body.Agents[0])
		}
	}
	if source.calls != 2 {
		t.Fatalf("Snapshot 调用次数 = %d", source.calls)
	}
}

func TestAgentsHandler拒绝非GET(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, Path, strings.NewReader("secret command output"))
	response := httptest.NewRecorder()
	NewHandler(&sequenceSource{}).ServeHTTP(response, request)

	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("状态码 = %d", response.Code)
	}
	if got := response.Header().Get("Allow"); got != http.MethodGet {
		t.Fatalf("Allow = %q", got)
	}
	if got := response.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q", got)
	}
	if strings.Contains(response.Body.String(), "secret") {
		t.Fatalf("响应泄露请求内容: %s", response.Body.String())
	}
	assertErrorCode(t, response, "method_not_allowed")
}

func TestAgentsHandler只允许切换当前快照中的Agent(t *testing.T) {
	source := &focusableSource{sequenceSource: sequenceSource{snapshots: []herdrsource.Snapshot{{
		Online: true,
		Agents: []herdrsource.AgentObservation{{SourceID: "term-current"}},
	}}}}
	handler := NewHandler(source)

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, Path+"/term-current/focus", nil))
	if response.Code != http.StatusNoContent || source.focused != "term-current" {
		t.Fatalf("切换结果 status=%d focused=%q body=%s", response.Code, source.focused, response.Body.String())
	}

	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, Path+"/term-stale/focus", nil))
	if response.Code != http.StatusNotFound || source.focused != "term-current" {
		t.Fatalf("过期 Agent 结果 status=%d focused=%q body=%s", response.Code, source.focused, response.Body.String())
	}
}

func TestAgentsHandler读取历史并发送消息(t *testing.T) {
	source := &focusableSource{
		sequenceSource: sequenceSource{snapshots: []herdrsource.Snapshot{{
			Online: true,
			Agents: []herdrsource.AgentObservation{{SourceID: "term-current"}},
		}}},
		history: herdrsource.AgentHistory{Text: "历史输出", Revision: 8, Truncated: true},
	}
	handler := NewHandler(source).(*handler)
	handler.now = func() time.Time { return time.Date(2026, 7, 16, 9, 0, 0, 0, time.UTC) }

	historyResponse := httptest.NewRecorder()
	handler.ServeHTTP(historyResponse, httptest.NewRequest(http.MethodGet, Path+"/term-current/history", nil))
	if historyResponse.Code != http.StatusOK {
		t.Fatalf("历史状态码 = %d, body = %s", historyResponse.Code, historyResponse.Body.String())
	}
	var history HistoryResponse
	if err := json.Unmarshal(historyResponse.Body.Bytes(), &history); err != nil {
		t.Fatalf("解析历史: %v", err)
	}
	if history.Text != "历史输出" || history.Revision != 8 || !history.Truncated {
		t.Fatalf("历史 = %#v", history)
	}

	messageResponse := httptest.NewRecorder()
	handler.ServeHTTP(messageResponse, httptest.NewRequest(http.MethodPost, Path+"/term-current/messages", strings.NewReader(`{"text":"继续完成演示"}`)))
	if messageResponse.Code != http.StatusNoContent || source.sent != "继续完成演示" {
		t.Fatalf("发送结果 status=%d sent=%q body=%s", messageResponse.Code, source.sent, messageResponse.Body.String())
	}
}

func TestAgentsHandler拒绝空消息与未知Agent(t *testing.T) {
	source := &focusableSource{sequenceSource: sequenceSource{snapshots: []herdrsource.Snapshot{{
		Online: true,
		Agents: []herdrsource.AgentObservation{{SourceID: "term-current"}},
	}}}}
	handler := NewHandler(source)

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, Path+"/term-current/messages", strings.NewReader(`{"text":"   "}`)))
	if response.Code != http.StatusBadRequest || source.sent != "" {
		t.Fatalf("空消息结果 status=%d sent=%q", response.Code, source.sent)
	}

	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, Path+"/term-stale/history", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("未知 Agent 历史状态码 = %d", response.Code)
	}
}

func TestAgentsHandler来源错误返回脱敏结构化503(t *testing.T) {
	secret := "secret command output: bearer-token"
	source := &sequenceSource{err: errors.New(secret)}
	request := httptest.NewRequest(http.MethodGet, Path, nil)
	response := httptest.NewRecorder()
	NewHandler(source).ServeHTTP(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("状态码 = %d, body = %s", response.Code, response.Body.String())
	}
	if got := response.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q", got)
	}
	if strings.Contains(response.Body.String(), secret) {
		t.Fatalf("503 泄露来源错误: %s", response.Body.String())
	}
	assertErrorCode(t, response, "source_unavailable")
}

func TestAgentsHandler离线Snapshot返回503(t *testing.T) {
	source := &sequenceSource{snapshots: []herdrsource.Snapshot{{Online: false}}}
	response := httptest.NewRecorder()
	NewHandler(source).ServeHTTP(response, httptest.NewRequest(http.MethodGet, Path, nil))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("状态码 = %d, body = %s", response.Code, response.Body.String())
	}
	assertErrorCode(t, response, "source_unavailable")
}

func TestAgentsHandlerInterruptsRunningAgent(t *testing.T) {
	source := &focusableSource{sequenceSource: sequenceSource{snapshots: []herdrsource.Snapshot{{
		Online: true,
		Agents: []herdrsource.AgentObservation{{SourceID: "term-current"}},
	}}}}
	handler := NewHandler(source)

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, Path+"/term-current/interrupt", nil))
	if response.Code != http.StatusNoContent || source.interrupted != "term-current" {
		t.Fatalf("叫停结果 status=%d interrupted=%q body=%s", response.Code, source.interrupted, response.Body.String())
	}

	// 不存在的 Agent → 404
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, Path+"/term-stale/interrupt", nil))
	if response.Code != http.StatusNotFound || source.interrupted != "term-current" {
		t.Fatalf("过期 Agent 叫停 status=%d interrupted=%q body=%s", response.Code, source.interrupted, response.Body.String())
	}
}

func TestAgentsHandlerInterruptUnsupportedReturns501(t *testing.T) {
	// sequenceSource 不实现 Interrupt，模拟 *herdrsource.Fake 的能力形状
	// （与 #23 的 capability 回归测试同一类正确性）。
	source := &sequenceSource{snapshots: []herdrsource.Snapshot{{
		Online: true,
		Agents: []herdrsource.AgentObservation{{SourceID: "term-current"}},
	}}}
	response := httptest.NewRecorder()
	NewHandler(source).ServeHTTP(response, httptest.NewRequest(http.MethodPost, Path+"/term-current/interrupt", nil))
	if response.Code != http.StatusNotImplemented {
		t.Fatalf("状态码 = %d, body = %s", response.Code, response.Body.String())
	}
	assertErrorCode(t, response, "interrupt_unsupported")
}

func TestAgentsHandlerInterruptRejectsNonPOST(t *testing.T) {
	source := &focusableSource{sequenceSource: sequenceSource{snapshots: []herdrsource.Snapshot{{
		Online: true,
		Agents: []herdrsource.AgentObservation{{SourceID: "term-current"}},
	}}}}
	response := httptest.NewRecorder()
	NewHandler(source).ServeHTTP(response, httptest.NewRequest(http.MethodGet, Path+"/term-current/interrupt", nil))
	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("状态码 = %d", response.Code)
	}
	if got := response.Header().Get("Allow"); got != http.MethodPost {
		t.Fatalf("Allow = %q", got)
	}
	assertErrorCode(t, response, "method_not_allowed")
}

func TestServe已取消Context不会启动监听(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := Serve(ctx, "invalid address", &sequenceSource{}, nil, t.TempDir()); err != nil {
		t.Fatalf("Serve = %v", err)
	}
}

func assertErrorCode(t *testing.T, response *httptest.ResponseRecorder, want string) {
	t.Helper()
	var body ErrorResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("解析错误响应: %v", err)
	}
	if body.DemoVersion != 0 || body.Error.Code != want {
		t.Fatalf("错误响应 = %#v", body)
	}
}

type sequenceSource struct {
	snapshots []herdrsource.Snapshot
	err       error
	calls     int
}

type focusableSource struct {
	sequenceSource
	focused    string
	interrupted string
	history   herdrsource.AgentHistory
	sent      string
}

func (s *focusableSource) ReadAgentHistory(_ context.Context, _ string, _ int) (herdrsource.AgentHistory, error) {
	return s.history, nil
}

func (s *focusableSource) SendAgentMessage(_ context.Context, _ string, text string) error {
	s.sent = text
	return nil
}

func (s *focusableSource) FocusAgent(_ context.Context, sourceID string) error {
	s.focused = sourceID
	return nil
}

func (s *focusableSource) Interrupt(_ context.Context, sourceID string) error {
	s.interrupted = sourceID
	return nil
}

func (*sequenceSource) Name() string { return "测试来源" }

func (s *sequenceSource) Snapshot(context.Context) (herdrsource.Snapshot, error) {
	s.calls++
	if s.err != nil {
		return herdrsource.Snapshot{}, s.err
	}
	if len(s.snapshots) == 0 {
		return herdrsource.Snapshot{}, nil
	}
	index := s.calls - 1
	if index >= len(s.snapshots) {
		index = len(s.snapshots) - 1
	}
	return s.snapshots[index], nil
}

func (*sequenceSource) Changes(context.Context, string) (herdrsource.ChangeBatch, error) {
	return herdrsource.ChangeBatch{}, errors.New("unsupported")
}

func (*sequenceSource) Capabilities(context.Context) (herdrsource.Capabilities, error) {
	return herdrsource.Capabilities{ObserveAgents: true}, nil
}
