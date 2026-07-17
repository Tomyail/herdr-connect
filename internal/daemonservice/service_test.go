package daemonservice

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fakeRunner struct {
	calls  []string
	output string
	err    error
}

func (f *fakeRunner) Run(_ context.Context, _, _ io.Writer, name string, args ...string) error {
	f.calls = append(f.calls, strings.Join(append([]string{name}, args...), " "))
	return f.err
}
func (f *fakeRunner) Output(_ context.Context, name string, args ...string) ([]byte, error) {
	f.calls = append(f.calls, strings.Join(append([]string{name}, args...), " "))
	return []byte(f.output), f.err
}

func TestRenderServiceConfigsPinExecutableAndHerdrPaths(t *testing.T) {
	for _, osName := range []string{"darwin", "linux"} {
		runner := &fakeRunner{}
		manager, err := newManager(osName, t.TempDir(), runner)
		if err != nil {
			t.Fatal(err)
		}
		content := string(manager.render(InstallOptions{Executable: "/opt/herdr connect/bin/herdr-connect", HerdrPath: "/opt/herdr/bin/herdr"}))
		for _, expected := range []string{Marker, "demo-lan", "/opt/herdr", "HERDR_CONNECT_HERDR_PATH"} {
			if !strings.Contains(content, expected) {
				t.Fatalf("%s config missing %q:\n%s", osName, expected, content)
			}
		}
	}
}

func TestInstallIsManagedIdempotentAndRollsBackFailure(t *testing.T) {
	home := t.TempDir()
	runner := &fakeRunner{}
	manager, _ := newManager("linux", home, runner)
	options := InstallOptions{Executable: "/usr/local/bin/herdr-connect", HerdrPath: "/usr/local/bin/herdr"}
	if err := manager.Install(context.Background(), options); err != nil {
		t.Fatal(err)
	}
	if err := manager.Install(context.Background(), options); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(manager.configPath)
	if err != nil || !strings.Contains(string(content), Marker) {
		t.Fatalf("managed config: %v %s", err, content)
	}

	runner.err = errors.New("start failed")
	previous := append([]byte(nil), content...)
	if err := manager.Install(context.Background(), InstallOptions{Executable: "/new/herdr-connect", HerdrPath: "/new/herdr"}); err == nil {
		t.Fatal("expected install failure")
	}
	after, _ := os.ReadFile(manager.configPath)
	if string(after) != string(previous) {
		t.Fatal("failed update did not restore previous config")
	}
}

func TestUninstallRefusesUnmanagedConfigAndPreservesData(t *testing.T) {
	home := t.TempDir()
	manager, _ := newManager("darwin", home, &fakeRunner{})
	if err := os.MkdirAll(filepath.Dir(manager.configPath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manager.configPath, []byte("unmanaged"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := manager.Uninstall(context.Background()); err == nil || !strings.Contains(err.Error(), "unmanaged") {
		t.Fatalf("error = %v", err)
	}
}

func TestStatusParsesManagerStateAndHerdrPath(t *testing.T) {
	home := t.TempDir()
	runner := &fakeRunner{output: "ActiveState=active\nMainPID=42\n"}
	manager, _ := newManager("linux", home, runner)
	if err := os.MkdirAll(filepath.Dir(manager.configPath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manager.configPath, manager.render(InstallOptions{Executable: "/bin/connect", HerdrPath: "/bin/herdr"}), 0o600); err != nil {
		t.Fatal(err)
	}
	status, err := manager.Status(context.Background())
	if err != nil || !status.Installed || !status.Running || status.PID != 42 || status.HerdrPath != "/bin/herdr" {
		t.Fatalf("status=%#v err=%v", status, err)
	}
}
