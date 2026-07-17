package daemoncli_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
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
	for _, warning := range []string{"no authentication", "no encryption", "trusted, controlled LAN"} {
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

func Test帮助版本和解析错误不会初始化来源或数据库(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		args       []string
		wantCode   int
		wantOutput string
		stderr     bool
	}{
		{name: "long help", args: []string{"--help"}, wantOutput: "Usage:"},
		{name: "short help", args: []string{"-h"}, wantOutput: "Safety:"},
		{name: "help command", args: []string{"help"}, wantOutput: "Commands:"},
		{name: "help topic", args: []string{"help", "doctor"}, wantOutput: "doctor [--json]"},
		{name: "service help topic", args: []string{"help", "service"}, wantOutput: "service <install|status|logs|restart|uninstall>"},
		{name: "service action help", args: []string{"help", "service", "logs"}, wantOutput: "service logs [--tail]"},
		{name: "service inline help", args: []string{"service", "install", "--help"}, wantOutput: "service install [--herdr ABSOLUTE_PATH]"},
		{name: "command long help", args: []string{"doctor", "--help"}, wantOutput: "Herdr CLI/source"},
		{name: "command short help", args: []string{"demo-lan", "-h"}, wantOutput: "no authentication"},
		{name: "version flag", args: []string{"--version"}, wantOutput: "herdr-connect development"},
		{name: "version command", args: []string{"version"}, wantOutput: "herdr-connect development"},
		{name: "version command help", args: []string{"version", "--help"}, wantOutput: "release version"},
		{name: "help command help", args: []string{"help", "-h"}, wantOutput: "help [command]"},
		{name: "missing command", args: nil, wantCode: 2, wantOutput: "a command is required", stderr: true},
		{name: "unknown command", args: []string{"doctr"}, wantCode: 2, wantOutput: `Did you mean "doctor"?`, stderr: true},
		{name: "bad command argument", args: []string{"status", "extra"}, wantCode: 2, wantOutput: "does not accept arguments", stderr: true},
		{name: "bad source", args: []string{"--source", "missing", "status"}, wantCode: 2, wantOutput: "unknown source", stderr: true},
		{name: "missing service action", args: []string{"service"}, wantCode: 2, wantOutput: "service requires an action", stderr: true},
		{name: "unknown service action", args: []string{"service", "start"}, wantCode: 2, wantOutput: "unknown service action", stderr: true},
		{name: "bad service option", args: []string{"service", "logs", "--follow"}, wantCode: 2, wantOutput: "accepts only --tail", stderr: true},
		{name: "relative Herdr path", args: []string{"service", "install", "--herdr", "bin/herdr"}, wantCode: 2, wantOutput: "ABSOLUTE_PATH", stderr: true},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			dbPath := filepath.Join(t.TempDir(), "must-not-exist.db")
			args := append([]string{"--db", dbPath}, test.args...)
			factoryCalls := 0
			var stdout, stderr bytes.Buffer
			code := daemoncli.Execute(context.Background(), args, &stdout, &stderr, func(string) (herdrsource.Source, error) {
				factoryCalls++
				return nil, errors.New("source factory must not be called")
			})
			if code != test.wantCode {
				t.Fatalf("exit = %d, want %d; stdout=%s stderr=%s", code, test.wantCode, stdout.String(), stderr.String())
			}
			output := stdout.String()
			if test.stderr {
				output = stderr.String()
				if stdout.Len() != 0 {
					t.Fatalf("usage error wrote stdout: %s", stdout.String())
				}
			} else if stderr.Len() != 0 {
				t.Fatalf("successful informational command wrote stderr: %s", stderr.String())
			}
			if !strings.Contains(output, test.wantOutput) {
				t.Fatalf("output missing %q: %s", test.wantOutput, output)
			}
			if factoryCalls != 0 {
				t.Fatalf("source factory called %d times", factoryCalls)
			}
			if _, err := os.Stat(dbPath); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("database was touched: %v", err)
			}
		})
	}
}

func Test每个运行命令拒绝未声明参数且不初始化依赖(t *testing.T) {
	t.Parallel()

	for _, command := range []string{"status", "agents", "capabilities", "diagnostics", "doctor", "migrations", "trace", "daemon", "demo-lan"} {
		command := command
		t.Run(command, func(t *testing.T) {
			dbPath := filepath.Join(t.TempDir(), "must-not-exist.db")
			var stdout, stderr bytes.Buffer
			factoryCalls := 0
			code := daemoncli.Execute(context.Background(), []string{"--db", dbPath, command, "--not-an-option"}, &stdout, &stderr, func(string) (herdrsource.Source, error) {
				factoryCalls++
				return nil, errors.New("unexpected source initialization")
			})
			if code != 2 || stdout.Len() != 0 || !strings.Contains(stderr.String(), "error:") {
				t.Fatalf("exit=%d stdout=%q stderr=%q", code, stdout.String(), stderr.String())
			}
			if factoryCalls != 0 {
				t.Fatalf("source factory called %d times", factoryCalls)
			}
			if _, err := os.Stat(dbPath); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("database was touched: %v", err)
			}
		})
	}
}

func TestDaemonOnce接受唯一命令选项(t *testing.T) {
	t.Parallel()

	var stdout, stderr bytes.Buffer
	code := daemoncli.Execute(context.Background(), []string{"--db", filepath.Join(t.TempDir(), "daemon.db"), "--source", "fake", "daemon", "--once"}, &stdout, &stderr, fakeFactory)
	if code != 0 || stderr.Len() != 0 {
		t.Fatalf("exit=%d stderr=%s", code, stderr.String())
	}
	var result map[string]any
	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
		t.Fatalf("daemon --once output: %v", err)
	}
	if result["source_online"] != true || result["agent_count"] != float64(1) {
		t.Fatalf("daemon --once result: %#v", result)
	}
}

func TestExecuteVersion使用注入版本并对空值回退(t *testing.T) {
	t.Parallel()

	for _, test := range []struct{ version, want string }{{"0.2.0", "0.2.0"}, {"", "development"}} {
		var stdout, stderr bytes.Buffer
		code := daemoncli.ExecuteVersion(context.Background(), []string{"--version"}, &stdout, &stderr, fakeFactory, test.version)
		if code != 0 || stderr.Len() != 0 || stdout.String() != "herdr-connect "+test.want+"\n" {
			t.Fatalf("version %q: code=%d stdout=%q stderr=%q", test.version, code, stdout.String(), stderr.String())
		}
	}
}

func TestDiagnostics默认JSON保持兼容且显式JSON等价(t *testing.T) {
	t.Parallel()

	var outputs [2]map[string]any
	for index, args := range [][]string{{"diagnostics"}, {"diagnostics", "--json"}} {
		var stdout, stderr bytes.Buffer
		fullArgs := append([]string{"--db", filepath.Join(t.TempDir(), "daemon.db"), "--source", "fake"}, args...)
		code := daemoncli.Execute(context.Background(), fullArgs, &stdout, &stderr, fakeFactory)
		if code != 0 || stderr.Len() != 0 {
			t.Fatalf("exit=%d stderr=%s", code, stderr.String())
		}
		if err := json.Unmarshal(stdout.Bytes(), &outputs[index]); err != nil {
			t.Fatalf("parse diagnostics: %v", err)
		}
		for _, key := range []string{"database", "schema_version", "source_name", "source_online", "agent_count", "through_event_seq"} {
			if _, ok := outputs[index][key]; !ok {
				t.Fatalf("missing compatibility field %q: %#v", key, outputs[index])
			}
		}
		if len(outputs[index]) != 6 {
			t.Fatalf("unexpected diagnostics shape: %#v", outputs[index])
		}
	}
}

func TestDoctor提供人类可读和JSON诊断及下一步(t *testing.T) {
	t.Parallel()

	for _, jsonMode := range []bool{false, true} {
		args := []string{"--db", filepath.Join(t.TempDir(), "daemon.db"), "--source", "fake", "doctor"}
		if jsonMode {
			args = append(args, "--json")
		}
		var stdout, stderr bytes.Buffer
		code := daemoncli.ExecuteWithPreviewChecker(context.Background(), args, &stdout, &stderr, fakeFactory, func(context.Context) daemoncli.PreviewStatus {
			return daemoncli.PreviewAvailable
		})
		if code != 0 || stderr.Len() != 0 {
			t.Fatalf("json=%v exit=%d stderr=%s", jsonMode, code, stderr.String())
		}
		if jsonMode {
			var report map[string]any
			if err := json.Unmarshal(stdout.Bytes(), &report); err != nil {
				t.Fatalf("doctor JSON: %v", err)
			}
			if report["database"] == nil || report["source"] == nil || report["next_step"] == nil {
				t.Fatalf("doctor JSON incomplete: %#v", report)
			}
		} else {
			for _, text := range []string{"[OK] Database", "[OK] Herdr CLI/source", "[OK] Agents: 1 found", "[OK] LAN preview port: TCP 9808 is available", "Next:", "service install"} {
				if !strings.Contains(stdout.String(), text) {
					t.Fatalf("doctor output missing %q: %s", text, stdout.String())
				}
			}
		}
	}
}

func TestDoctor来源不可用时给出可执行下一步且不泄露错误(t *testing.T) {
	t.Parallel()

	secret := "secret prompt and token"
	var stdout, stderr bytes.Buffer
	code := daemoncli.ExecuteWithPreviewChecker(context.Background(), []string{"--db", filepath.Join(t.TempDir(), "daemon.db"), "doctor"}, &stdout, &stderr, func(string) (herdrsource.Source, error) {
		return failingSource{err: errors.New(secret)}, nil
	}, func(context.Context) daemoncli.PreviewStatus {
		return daemoncli.PreviewAvailable
	})
	if code != 1 || stderr.Len() != 0 {
		t.Fatalf("exit=%d stderr=%s", code, stderr.String())
	}
	for _, text := range []string{"[OK] Database", "[FAIL] Herdr CLI/source", "herdr agent list", "doctor' again"} {
		if !strings.Contains(stdout.String(), text) {
			t.Fatalf("output missing %q: %s", text, stdout.String())
		}
	}
	if strings.Contains(stdout.String(), secret) {
		t.Fatalf("doctor leaked source error: %s", stdout.String())
	}
}

func TestDoctor识别已经运行的Preview而不建议重复启动(t *testing.T) {
	t.Parallel()

	var stdout, stderr bytes.Buffer
	code := daemoncli.ExecuteWithPreviewChecker(context.Background(), []string{"--db", filepath.Join(t.TempDir(), "daemon.db"), "--source", "fake", "doctor"}, &stdout, &stderr, fakeFactory, func(context.Context) daemoncli.PreviewStatus {
		return daemoncli.PreviewRunning
	})
	if code != 0 || stderr.Len() != 0 {
		t.Fatalf("exit=%d stderr=%s", code, stderr.String())
	}
	if !strings.Contains(stdout.String(), "[OK] LAN preview: already running on TCP 9808") || !strings.Contains(stdout.String(), "Open Herdr Connect") || strings.Contains(stdout.String(), "--source herdr demo-lan") {
		t.Fatalf("doctor did not recognize running preview:\n%s", stdout.String())
	}
}

func TestDoctor不会在Preview端口被占用时错误报告Ready(t *testing.T) {
	t.Parallel()

	var stdout, stderr bytes.Buffer
	code := daemoncli.ExecuteWithPreviewChecker(context.Background(), []string{"--db", filepath.Join(t.TempDir(), "daemon.db"), "--source", "fake", "doctor"}, &stdout, &stderr, fakeFactory, func(context.Context) daemoncli.PreviewStatus {
		return daemoncli.PreviewOccupied
	})
	if code != 1 || stderr.Len() != 0 {
		t.Fatalf("exit=%d stderr=%s", code, stderr.String())
	}
	if !strings.Contains(stdout.String(), "[FAIL] LAN preview port: TCP 9808 is already in use") || strings.Contains(stdout.String(), "Next: Ready") {
		t.Fatalf("doctor incorrectly reported ready:\n%s", stdout.String())
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
