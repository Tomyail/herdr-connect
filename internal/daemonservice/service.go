package daemonservice

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"html"
	"io"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

const (
	Marker      = "Managed by Herdr Connect CLI"
	LaunchLabel = "com.tomyail.herdr-connect"
	UnitName    = "herdr-connect.service"
)

var ErrNotInstalled = errors.New("Herdr Connect service is not installed")

type Status struct {
	Installed bool   `json:"installed"`
	Running   bool   `json:"running"`
	PID       int    `json:"pid,omitempty"`
	Manager   string `json:"manager"`
	Config    string `json:"config"`
	HerdrPath string `json:"herdr_path,omitempty"`
}

type InstallOptions struct {
	Executable string
	HerdrPath  string
	Verify     func(context.Context) error
}

type Manager interface {
	Install(context.Context, InstallOptions) error
	Status(context.Context) (Status, error)
	Logs(context.Context, io.Writer, bool) error
	Restart(context.Context, func(context.Context) error) error
	Uninstall(context.Context) error
}

type commandRunner interface {
	Run(context.Context, io.Writer, io.Writer, string, ...string) error
	Output(context.Context, string, ...string) ([]byte, error)
}

type execRunner struct{}

func (execRunner) Run(ctx context.Context, stdout, stderr io.Writer, name string, args ...string) error {
	command := exec.CommandContext(ctx, name, args...)
	command.Stdout, command.Stderr = stdout, stderr
	return command.Run()
}

func (execRunner) Output(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).CombinedOutput()
}

type manager struct {
	osName     string
	home       string
	configPath string
	logPath    string
	errorPath  string
	uid        string
	runner     commandRunner
}

func New() (Manager, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("resolve home directory: %w", err)
	}
	return newManager(runtime.GOOS, home, execRunner{})
}

func newManager(osName, home string, runner commandRunner) (*manager, error) {
	result := &manager{osName: osName, home: home, runner: runner}
	switch osName {
	case "darwin":
		current, err := user.Current()
		if err != nil {
			return nil, fmt.Errorf("resolve current owner ID: %w", err)
		}
		if current.Uid == "" {
			return nil, errors.New("resolve current owner ID: empty UID")
		}
		result.uid = current.Uid
		result.configPath = filepath.Join(home, "Library", "LaunchAgents", LaunchLabel+".plist")
		result.logPath = filepath.Join(home, "Library", "Logs", "Herdr Connect", "daemon.log")
		result.errorPath = filepath.Join(home, "Library", "Logs", "Herdr Connect", "daemon.error.log")
	case "linux":
		result.configPath = filepath.Join(home, ".config", "systemd", "user", UnitName)
	default:
		return nil, fmt.Errorf("service management is not supported on %s", osName)
	}
	return result, nil
}

func (m *manager) Install(ctx context.Context, options InstallOptions) error {
	if !filepath.IsAbs(options.Executable) || !filepath.IsAbs(options.HerdrPath) {
		return errors.New("service executable and Herdr paths must be absolute")
	}
	if current, err := os.ReadFile(m.configPath); err == nil && !strings.Contains(string(current), Marker) {
		return fmt.Errorf("refusing to overwrite unmanaged service config %s", m.configPath)
	}
	content := m.render(options)
	previous, existed, err := replaceManagedFile(m.configPath, content)
	if err != nil {
		return err
	}
	rollback := func() {
		if existed {
			_ = os.WriteFile(m.configPath, previous, 0o600)
		} else {
			_ = os.Remove(m.configPath)
		}
		_ = m.reload(context.Background())
		if existed {
			_ = m.start(context.Background(), false)
		}
	}
	if m.osName == "darwin" {
		_ = os.MkdirAll(filepath.Dir(m.logPath), 0o700)
		_ = os.Chmod(filepath.Dir(m.logPath), 0o700)
		for _, path := range []string{m.logPath, m.errorPath} {
			file, createErr := os.OpenFile(path, os.O_CREATE|os.O_APPEND, 0o600)
			if createErr != nil {
				rollback()
				return fmt.Errorf("prepare service log %s: %w", path, createErr)
			}
			_ = file.Close()
			_ = os.Chmod(path, 0o600)
		}
	}
	if err := m.reload(ctx); err != nil {
		rollback()
		return err
	}
	if err := m.start(ctx, existed); err != nil {
		rollback()
		return err
	}
	if options.Verify != nil {
		if err := options.Verify(ctx); err != nil {
			_ = m.stop(context.Background())
			rollback()
			return fmt.Errorf("service failed its startup check: %w", err)
		}
	}
	return nil
}

func (m *manager) Status(ctx context.Context) (Status, error) {
	status := Status{Manager: m.managerName(), Config: m.configPath}
	content, err := os.ReadFile(m.configPath)
	if errors.Is(err, os.ErrNotExist) {
		return status, ErrNotInstalled
	}
	if err != nil {
		return status, err
	}
	status.Installed = true
	status.HerdrPath = configuredHerdrPath(string(content), m.osName)
	var output []byte
	if m.osName == "darwin" {
		output, err = m.runner.Output(ctx, "launchctl", "print", fmt.Sprintf("gui/%s/%s", m.uid, LaunchLabel))
	} else {
		output, err = m.runner.Output(ctx, "systemctl", "--user", "show", UnitName, "--property=ActiveState,MainPID", "--no-pager")
	}
	if err != nil {
		return status, nil
	}
	status.Running = strings.Contains(string(output), "state = running") || strings.Contains(string(output), "ActiveState=active")
	status.PID = parsePID(string(output))
	return status, nil
}

func (m *manager) Logs(ctx context.Context, stdout io.Writer, tail bool) error {
	if _, err := os.Stat(m.configPath); errors.Is(err, os.ErrNotExist) {
		return ErrNotInstalled
	}
	if m.osName == "linux" {
		args := []string{"--user", "-u", UnitName, "-n", "100", "--no-pager"}
		if tail {
			args = append(args, "-f")
		}
		return m.runner.Run(ctx, stdout, stdout, "journalctl", args...)
	}
	args := []string{"-n", "100"}
	if tail {
		args = append(args, "-f")
	}
	args = append(args, m.logPath, m.errorPath)
	return m.runner.Run(ctx, stdout, stdout, "/usr/bin/tail", args...)
}

func (m *manager) Restart(ctx context.Context, verify func(context.Context) error) error {
	if _, err := os.Stat(m.configPath); errors.Is(err, os.ErrNotExist) {
		return ErrNotInstalled
	}
	if m.osName == "darwin" {
		if err := m.runner.Run(ctx, io.Discard, io.Discard, "launchctl", "kickstart", "-k", fmt.Sprintf("gui/%s/%s", m.uid, LaunchLabel)); err != nil {
			domain := fmt.Sprintf("gui/%s", m.uid)
			if bootstrapErr := m.runner.Run(ctx, io.Discard, io.Discard, "launchctl", "bootstrap", domain, m.configPath); bootstrapErr != nil {
				return fmt.Errorf("restart LaunchAgent: %w", err)
			}
		}
	} else if err := m.runner.Run(ctx, io.Discard, io.Discard, "systemctl", "--user", "restart", UnitName); err != nil {
		return fmt.Errorf("restart systemd user service: %w", err)
	}
	if verify != nil {
		return verify(ctx)
	}
	return nil
}

func (m *manager) Uninstall(ctx context.Context) error {
	content, err := os.ReadFile(m.configPath)
	if errors.Is(err, os.ErrNotExist) {
		return ErrNotInstalled
	}
	if err != nil {
		return err
	}
	if !strings.Contains(string(content), Marker) {
		return fmt.Errorf("refusing to remove unmanaged service config %s", m.configPath)
	}
	_ = m.stop(ctx)
	if err := os.Remove(m.configPath); err != nil {
		return err
	}
	return m.reload(ctx)
}

func (m *manager) render(options InstallOptions) []byte {
	if m.osName == "darwin" {
		return []byte(fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- %s -->
<plist version="1.0"><dict>
<key>Label</key><string>%s</string>
<key>ProgramArguments</key><array><string>%s</string><string>--source</string><string>herdr</string><string>demo-lan</string></array>
<key>EnvironmentVariables</key><dict><key>HERDR_CONNECT_HERDR_PATH</key><string>%s</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>ThrottleInterval</key><integer>5</integer>
<key>StandardOutPath</key><string>%s</string><key>StandardErrorPath</key><string>%s</string>
</dict></plist>
`, Marker, LaunchLabel, html.EscapeString(options.Executable), html.EscapeString(options.HerdrPath), html.EscapeString(m.logPath), html.EscapeString(m.errorPath)))
	}
	return []byte(fmt.Sprintf(`# %s
[Unit]
Description=Herdr Connect LAN preview
After=network.target

[Service]
Type=simple
Environment=HERDR_CONNECT_HERDR_PATH=%s
ExecStart=%s --source herdr demo-lan
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`, Marker, systemdQuote(options.HerdrPath), systemdQuote(options.Executable)))
}

func (m *manager) start(ctx context.Context, existed bool) error {
	if m.osName == "darwin" {
		domain := fmt.Sprintf("gui/%s", m.uid)
		if existed {
			_ = m.runner.Run(ctx, io.Discard, io.Discard, "launchctl", "bootout", domain+"/"+LaunchLabel)
		}
		if err := m.runner.Run(ctx, io.Discard, io.Discard, "launchctl", "bootstrap", domain, m.configPath); err != nil {
			return fmt.Errorf("start LaunchAgent: %w", err)
		}
		return nil
	}
	if err := m.runner.Run(ctx, io.Discard, io.Discard, "systemctl", "--user", "enable", "--now", UnitName); err != nil {
		return fmt.Errorf("start systemd user service: %w", err)
	}
	return nil
}

func (m *manager) stop(ctx context.Context) error {
	if m.osName == "darwin" {
		return m.runner.Run(ctx, io.Discard, io.Discard, "launchctl", "bootout", fmt.Sprintf("gui/%s/%s", m.uid, LaunchLabel))
	}
	return m.runner.Run(ctx, io.Discard, io.Discard, "systemctl", "--user", "disable", "--now", UnitName)
}

func (m *manager) reload(ctx context.Context) error {
	if m.osName == "linux" {
		if err := m.runner.Run(ctx, io.Discard, io.Discard, "systemctl", "--user", "daemon-reload"); err != nil {
			return fmt.Errorf("reload systemd user services: %w", err)
		}
	}
	return nil
}

func (m *manager) managerName() string {
	if m.osName == "darwin" {
		return "launchd"
	}
	return "systemd-user"
}

func replaceManagedFile(path string, content []byte) ([]byte, bool, error) {
	previous, err := os.ReadFile(path)
	existed := err == nil
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, false, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, false, err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".herdr-connect-service-*")
	if err != nil {
		return nil, false, err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return nil, false, err
	}
	if _, err := temporary.Write(content); err != nil {
		_ = temporary.Close()
		return nil, false, err
	}
	if err := temporary.Close(); err != nil {
		return nil, false, err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return nil, false, err
	}
	return previous, existed, nil
}

func configuredHerdrPath(content, osName string) string {
	if osName == "darwin" {
		const key = "<key>HERDR_CONNECT_HERDR_PATH</key><string>"
		start := strings.Index(content, key)
		if start < 0 {
			return ""
		}
		remainder := content[start+len(key):]
		end := strings.Index(remainder, "</string>")
		if end >= 0 {
			return html.UnescapeString(remainder[:end])
		}
		return ""
	}
	scanner := bufio.NewScanner(strings.NewReader(content))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "Environment=HERDR_CONNECT_HERDR_PATH=") {
			value := strings.TrimPrefix(line, "Environment=HERDR_CONNECT_HERDR_PATH=")
			if unquoted, err := strconv.Unquote(value); err == nil {
				return strings.ReplaceAll(unquoted, "%%", "%")
			}
			return value
		}
	}
	return ""
}

func systemdQuote(value string) string { return strconv.Quote(strings.ReplaceAll(value, "%", "%%")) }

func parsePID(output string) int {
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		for _, prefix := range []string{"pid = ", "MainPID="} {
			if strings.HasPrefix(line, prefix) {
				pid, _ := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(line, prefix)))
				return pid
			}
		}
	}
	return 0
}
