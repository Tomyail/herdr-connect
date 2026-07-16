package daemoncli_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Tomyail/herdr-connect/internal/daemoncli"
	"github.com/Tomyail/herdr-connect/internal/herdrsource"
)

func TestCLI提供状态Agent能力诊断迁移和FakeTracer入口(t *testing.T) {
	t.Parallel()

	db := filepath.Join(t.TempDir(), "daemon.db")
	commands := []string{"status", "agents", "capabilities", "diagnostics", "migrations", "trace"}
	for _, command := range commands {
		command := command
		t.Run(command, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			code := daemoncli.Execute(context.Background(), []string{"--db", db, "--source", "fake", command}, &stdout, &stderr, fakeFactory)
			if code != 0 {
				t.Fatalf("exit = %d, stderr = %s", code, stderr.String())
			}
			var value any
			if err := json.Unmarshal(stdout.Bytes(), &value); err != nil {
				t.Fatalf("stdout 不是 JSON: %v\n%s", err, stdout.String())
			}
			if bytes.Contains(stdout.Bytes(), []byte("secret prompt")) || bytes.Contains(stderr.Bytes(), []byte("secret prompt")) {
				t.Fatal("CLI 日志包含 prompt")
			}
		})
	}
}

func Test能力缺失时CLI明确关闭写操作(t *testing.T) {
	t.Parallel()

	var stdout, stderr bytes.Buffer
	code := daemoncli.Execute(context.Background(), []string{"--source", "herdr", "capabilities"}, &stdout, &stderr, func(string) (herdrsource.Source, error) {
		return herdrsource.NewFake("herdr", herdrsource.Capabilities{ObserveAgents: true}, herdrsource.Snapshot{}), nil
	})
	if code != 0 {
		t.Fatalf("exit = %d, stderr = %s", code, stderr.String())
	}
	var caps herdrsource.Capabilities
	if err := json.Unmarshal(stdout.Bytes(), &caps); err != nil {
		t.Fatalf("解析能力: %v", err)
	}
	if caps.SendPrompt || caps.Interrupt {
		t.Fatalf("写能力未关闭: %#v", caps)
	}
}

func TestDemoLAN命令明确警告且已取消时正常退出(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var stdout, stderr bytes.Buffer
	code := daemoncli.Execute(ctx, []string{"--source", "fake", "demo-lan"}, &stdout, &stderr, fakeFactory)
	if code != 0 {
		t.Fatalf("exit = %d, stderr = %s", code, stderr.String())
	}
	for _, warning := range []string{"无认证", "无加密", "仅用于受控局域网演示"} {
		if !strings.Contains(stderr.String(), warning) {
			t.Fatalf("stderr 缺少 %q: %s", warning, stderr.String())
		}
	}
	if stdout.Len() != 0 {
		t.Fatalf("stdout = %s", stdout.String())
	}
}

func Test来源错误不会把敏感内容写入状态或日志(t *testing.T) {
	t.Parallel()

	secret := "prompt=绝密 Agent输出=绝密 私钥=private-key token=bearer-token"
	var stdout, stderr bytes.Buffer
	code := daemoncli.Execute(context.Background(), []string{
		"--db", filepath.Join(t.TempDir(), "daemon.db"), "status",
	}, &stdout, &stderr, func(string) (herdrsource.Source, error) {
		return failingSource{err: errors.New(secret)}, nil
	})
	if code != 0 {
		t.Fatalf("exit = %d, stderr = %s", code, stderr.String())
	}
	if bytes.Contains(stdout.Bytes(), []byte(secret)) || bytes.Contains(stderr.Bytes(), []byte(secret)) {
		t.Fatalf("状态或日志泄露来源错误中的敏感内容: stdout=%s stderr=%s", stdout.String(), stderr.String())
	}
	var state map[string]any
	if err := json.Unmarshal(stdout.Bytes(), &state); err != nil {
		t.Fatalf("解析离线状态: %v", err)
	}
	if online, ok := state["source_online"].(bool); !ok || online {
		t.Fatalf("离线来源状态 = %#v", state["source_online"])
	}
}

func fakeFactory(string) (herdrsource.Source, error) {
	return herdrsource.NewFake("fake", herdrsource.Capabilities{
		ObserveAgents:           true,
		IncrementalChanges:      true,
		TrustedInteractionState: true,
		TrustedTurnOutcome:      true,
		ReadOutput:              true,
		SendPrompt:              true,
		Interrupt:               true,
	}, herdrsource.Snapshot{
		Online: true,
		Cursor: "1",
		Agents: []herdrsource.AgentObservation{{
			SourceID:         "fake-agent-1",
			DisplayName:      "Fake Agent",
			TurnID:           "turn-1",
			Revision:         1,
			InteractionState: herdrsource.InteractionWorking,
		}},
	}), nil
}

type failingSource struct{ err error }

func (failingSource) Name() string { return "failing" }

func (f failingSource) Snapshot(context.Context) (herdrsource.Snapshot, error) {
	return herdrsource.Snapshot{}, f.err
}

func (failingSource) Changes(context.Context, string) (herdrsource.ChangeBatch, error) {
	return herdrsource.ChangeBatch{}, errors.New("unsupported")
}

func (failingSource) Capabilities(context.Context) (herdrsource.Capabilities, error) {
	return herdrsource.Capabilities{ObserveAgents: true}, nil
}
