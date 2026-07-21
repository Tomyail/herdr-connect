package daemoncli

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/Tomyail/herdr-connect/internal/daemonservice"
	"github.com/Tomyail/herdr-connect/internal/demolan"
	"github.com/Tomyail/herdr-connect/internal/herdrsource"
	"github.com/Tomyail/herdr-connect/internal/lanauth"
	"github.com/Tomyail/herdr-connect/internal/projection"
	"github.com/Tomyail/herdr-connect/internal/store"
)

const DevelopmentVersion = "development"

type SourceFactory func(string) (herdrsource.Source, error)

type PreviewStatus string

const (
	PreviewAvailable PreviewStatus = "available"
	PreviewRunning   PreviewStatus = "running"
	PreviewOccupied  PreviewStatus = "occupied"
)

type PreviewChecker func(context.Context) PreviewStatus

type options struct {
	dbPath      string
	sourceName  string
	command     string
	commandArgs []string
}

var commandNames = []string{
	"status", "agents", "capabilities", "diagnostics", "doctor", "service", "migrations", "trace", "daemon", "demo-lan", "pair", "devices",
}

// Execute runs the CLI with the explicit local-development version fallback.
func Execute(ctx context.Context, args []string, stdout, stderr io.Writer, sourceFactory SourceFactory) int {
	return execute(ctx, args, stdout, stderr, sourceFactory, DevelopmentVersion, checkPreview)
}

// ExecuteVersion runs the CLI with a build-provided version string.
func ExecuteVersion(ctx context.Context, args []string, stdout, stderr io.Writer, sourceFactory SourceFactory, version string) int {
	return execute(ctx, args, stdout, stderr, sourceFactory, version, checkPreview)
}

// ExecuteWithPreviewChecker provides a deterministic preview-port seam for CLI tests.
func ExecuteWithPreviewChecker(ctx context.Context, args []string, stdout, stderr io.Writer, sourceFactory SourceFactory, previewChecker PreviewChecker) int {
	return execute(ctx, args, stdout, stderr, sourceFactory, DevelopmentVersion, previewChecker)
}

func execute(ctx context.Context, args []string, stdout, stderr io.Writer, sourceFactory SourceFactory, version string, previewChecker PreviewChecker) int {
	parsed, earlyExit, code := parseArgs(args, stdout, stderr, version)
	if earlyExit {
		return code
	}
	if parsed.command == "service" {
		return runService(ctx, stdout, stderr, parsed.commandArgs, previewChecker)
	}

	if parsed.command == "demo-lan" {
		// 安全提示先于任何初始化输出；启动前已取消（如立即 SIGINT）保持干净退出。
		fmt.Fprintln(stderr, "demo-lan serves HTTPS with a self-signed certificate; only paired devices can read output or send input. Use it on a trusted, controlled LAN and revoke devices you no longer use.")
		if ctx.Err() != nil {
			return 0
		}
	}

	if parsed.command == "pair" {
		// 探活先于开库：没有运行中的 daemon 时直接退出，不创建 DB 文件、
		// 不触碰 sourceFactory（source 适配器与此命令无关）。
		if previewChecker(ctx) != PreviewRunning {
			fmt.Fprintln(stderr, "error: LAN daemon is not running; start it with 'herdr-connect demo-lan' and keep it running, then run 'herdr-connect pair' again")
			return 1
		}
	}

	source, database, code := prepareCommand(ctx, parsed, stderr, sourceFactory)
	if code != 0 {
		return code
	}
	if database != nil {
		defer database.Close()
	}

	switch parsed.command {
	case "migrations":
		return writeJSON(stdout, map[string]any{"database": parsed.dbPath, "schema_version": database.SchemaVersion()})
	case "capabilities":
		caps, err := source.Capabilities(ctx)
		if err != nil {
			return printError(stderr, err)
		}
		return writeJSON(stdout, caps)
	case "demo-lan":
		if err := demolan.Serve(ctx, demolan.DefaultAddress, source, database, filepath.Dir(parsed.dbPath)); err != nil {
			return printDemoLANError(stderr, err)
		}
		return 0
	case "pair":
		return runPair(ctx, newPairDeps(), database, filepath.Dir(parsed.dbPath), stdout, stderr)
	case "devices":
		return runDevices(ctx, database, parsed.commandArgs, stdout, stderr)
	}

	projector := projection.New(database)
	if parsed.command == "doctor" {
		return runDoctor(ctx, stdout, parsed.commandArgs, source, projector, database, parsed, previewChecker(ctx))
	}

	switch parsed.command {
	case "status", "agents", "diagnostics":
		state, syncErr := projector.Sync(ctx, source)
		if syncErr != nil {
			if parsed.command == "agents" {
				return printError(stderr, errors.New("Herdr source is unavailable; run 'herdr-connect doctor' for next steps"))
			}
			caps, err := source.Capabilities(ctx)
			if err != nil {
				return printError(stderr, err)
			}
			state, err = projector.Load(ctx, source.Name(), false, caps)
			if err != nil {
				return printError(stderr, err)
			}
		}
		switch parsed.command {
		case "agents":
			return writeJSON(stdout, state.Agents)
		case "diagnostics":
			diagnostics := diagnosticsJSON(parsed.dbPath, database, state, syncErr)
			return writeJSON(stdout, diagnostics)
		default:
			return writeJSON(stdout, state)
		}
	case "trace":
		return runTrace(ctx, stdout, stderr, source, projector)
	case "daemon":
		return runDaemon(ctx, stdout, stderr, source, projector, len(parsed.commandArgs) == 1)
	default:
		panic("validated command was not handled: " + parsed.command)
	}
}

func parseArgs(args []string, stdout, stderr io.Writer, version string) (options, bool, int) {
	parsed := options{dbPath: defaultDBPath(), sourceName: "herdr"}
	for len(args) > 0 {
		arg := args[0]
		switch {
		case arg == "-h" || arg == "--help":
			writeTopHelp(stdout)
			return parsed, true, 0
		case arg == "--version" || arg == "version":
			if arg == "version" && len(args) == 2 && (args[1] == "-h" || args[1] == "--help") {
				writeCommandHelp(stdout, "version")
				return parsed, true, 0
			}
			if len(args) != 1 {
				return usageError(stderr, "version does not accept arguments")
			}
			fmt.Fprintf(stdout, "herdr-connect %s\n", normalizedVersion(version))
			return parsed, true, 0
		case arg == "help":
			if len(args) == 2 && (args[1] == "-h" || args[1] == "--help") {
				writeCommandHelp(stdout, "help")
				return parsed, true, 0
			}
			if len(args) == 1 {
				writeTopHelp(stdout)
				return parsed, true, 0
			}
			if len(args) == 3 && args[1] == "service" && isServiceAction(args[2]) {
				writeServiceHelp(stdout, args[2])
				return parsed, true, 0
			}
			if len(args) != 2 {
				return usageError(stderr, "help accepts at most one command")
			}
			if !isHelpTopic(args[1]) {
				return unknownCommand(stderr, args[1])
			}
			writeCommandHelp(stdout, args[1])
			return parsed, true, 0
		case arg == "--db" || arg == "--source":
			if len(args) < 2 || strings.HasPrefix(args[1], "-") {
				return usageError(stderr, fmt.Sprintf("option %s requires a value", arg))
			}
			if arg == "--db" {
				parsed.dbPath = args[1]
			} else {
				parsed.sourceName = args[1]
			}
			args = args[2:]
			continue
		case strings.HasPrefix(arg, "--db="):
			parsed.dbPath = strings.TrimPrefix(arg, "--db=")
			if parsed.dbPath == "" {
				return usageError(stderr, "option --db requires a value")
			}
			args = args[1:]
			continue
		case strings.HasPrefix(arg, "--source="):
			parsed.sourceName = strings.TrimPrefix(arg, "--source=")
			if parsed.sourceName == "" {
				return usageError(stderr, "option --source requires a value")
			}
			args = args[1:]
			continue
		case strings.HasPrefix(arg, "-"):
			return usageError(stderr, fmt.Sprintf("unknown option %q", arg))
		default:
			parsed.command = arg
			parsed.commandArgs = args[1:]
			if !isCommand(parsed.command) {
				return unknownCommand(stderr, parsed.command)
			}
			if len(parsed.commandArgs) > 0 && (parsed.commandArgs[0] == "-h" || parsed.commandArgs[0] == "--help") {
				if len(parsed.commandArgs) != 1 {
					return usageError(stderr, fmt.Sprintf("%s --help does not accept arguments", parsed.command))
				}
				writeCommandHelp(stdout, parsed.command)
				return parsed, true, 0
			}
			if parsed.command == "service" && len(parsed.commandArgs) == 2 && isServiceAction(parsed.commandArgs[0]) && (parsed.commandArgs[1] == "-h" || parsed.commandArgs[1] == "--help") {
				writeServiceHelp(stdout, parsed.commandArgs[0])
				return parsed, true, 0
			}
			if message := validateCommandArgs(parsed.command, parsed.commandArgs); message != "" {
				return usageError(stderr, message)
			}
			if parsed.sourceName != "herdr" && parsed.sourceName != "fake" {
				return usageError(stderr, fmt.Sprintf("unknown source %q (expected herdr or fake)", parsed.sourceName))
			}
			return parsed, false, 0
		}
	}
	return usageError(stderr, "a command is required")
}

func usageError(stderr io.Writer, message string) (options, bool, int) {
	fmt.Fprintf(stderr, "error: %s\nRun 'herdr-connect help' for usage.\n", message)
	return options{}, true, 2
}

func unknownCommand(stderr io.Writer, command string) (options, bool, int) {
	fmt.Fprintf(stderr, "error: unknown command %q\n", command)
	if suggestion := suggestCommand(command); suggestion != "" {
		fmt.Fprintf(stderr, "Did you mean %q?\n", suggestion)
	}
	fmt.Fprintln(stderr, "Run 'herdr-connect help' for available commands.")
	return options{}, true, 2
}

func validateCommandArgs(command string, args []string) string {
	switch command {
	case "daemon":
		if len(args) == 0 || (len(args) == 1 && args[0] == "--once") {
			return ""
		}
		return "daemon accepts only --once"
	case "doctor":
		if len(args) == 0 || (len(args) == 1 && args[0] == "--json") {
			return ""
		}
		return "doctor accepts only --json"
	case "diagnostics":
		if len(args) == 0 || (len(args) == 1 && args[0] == "--json") {
			return ""
		}
		return "diagnostics accepts only --json"
	case "service":
		return validateServiceArgs(args)
	case "devices":
		return validateDevicesArgs(args)
	default:
		if len(args) != 0 {
			return fmt.Sprintf("%s does not accept arguments", command)
		}
		return ""
	}
}

func validateServiceArgs(args []string) string {
	if len(args) == 0 {
		return "service requires an action: install, status, logs, restart, or uninstall"
	}
	switch args[0] {
	case "install":
		if len(args) == 1 || (len(args) == 3 && args[1] == "--herdr" && filepath.IsAbs(args[2])) {
			return ""
		}
		return "service install accepts only --herdr ABSOLUTE_PATH"
	case "status":
		if len(args) == 1 || (len(args) == 2 && args[1] == "--json") {
			return ""
		}
		return "service status accepts only --json"
	case "logs":
		if len(args) == 1 || (len(args) == 2 && args[1] == "--tail") {
			return ""
		}
		return "service logs accepts only --tail"
	case "restart", "uninstall":
		if len(args) == 1 {
			return ""
		}
		return fmt.Sprintf("service %s does not accept arguments", args[0])
	default:
		return fmt.Sprintf("unknown service action %q", args[0])
	}
}

func isServiceAction(action string) bool {
	return action == "install" || action == "status" || action == "logs" || action == "restart" || action == "uninstall"
}

func prepareCommand(ctx context.Context, parsed options, stderr io.Writer, sourceFactory SourceFactory) (herdrsource.Source, *store.Store, int) {
	if parsed.command == "migrations" || parsed.command == "pair" || parsed.command == "devices" {
		// pair/migrations/devices 不需要 source adapter：只读写配对/设备表。
		database, err := store.Open(ctx, parsed.dbPath)
		if err != nil {
			return nil, nil, printError(stderr, err)
		}
		return nil, database, 0
	}
	source, err := sourceFactory(parsed.sourceName)
	if err != nil {
		return nil, nil, printError(stderr, err)
	}
	if parsed.command == "capabilities" {
		return source, nil, 0
	}
	database, err := store.Open(ctx, parsed.dbPath)
	if err != nil {
		return nil, nil, printError(stderr, err)
	}
	return source, database, 0
}

func runService(ctx context.Context, stdout, stderr io.Writer, args []string, previewChecker PreviewChecker) int {
	manager, err := daemonservice.New()
	if err != nil {
		return printError(stderr, err)
	}
	action := args[0]
	switch action {
	case "install":
		status, statusErr := manager.Status(ctx)
		managed := statusErr == nil && status.Installed
		if statusErr != nil && !errors.Is(statusErr, daemonservice.ErrNotInstalled) {
			return printError(stderr, statusErr)
		}
		if !managed && previewChecker(ctx) != PreviewAvailable {
			return printError(stderr, errors.New("TCP port 9808 is already in use; stop the existing process before installing the service"))
		}
		herdrPath := ""
		if len(args) == 3 {
			herdrPath = args[2]
			if !filepath.IsAbs(herdrPath) {
				return printError(stderr, errors.New("--herdr requires an absolute executable path"))
			}
		} else {
			herdrPath, err = exec.LookPath("herdr")
			if err != nil {
				return printError(stderr, errors.New("Herdr CLI was not found; install Herdr or pass --herdr ABSOLUTE_PATH"))
			}
		}
		herdrPath, err = validateExecutablePath(herdrPath, "Herdr")
		if err != nil {
			return printError(stderr, err)
		}
		executable, err := os.Executable()
		if err != nil {
			return printError(stderr, fmt.Errorf("resolve Herdr Connect executable: %w", err))
		}
		executable, err = filepath.Abs(executable)
		if err != nil {
			return printError(stderr, err)
		}
		if strings.Contains(executable, string(filepath.Separator)+"go-build") || strings.HasSuffix(executable, ".test") {
			return printError(stderr, errors.New("service install requires a persistent installed binary; install Herdr Connect first instead of using 'go run'"))
		}
		verify := func(checkCtx context.Context) error { return waitForPreview(checkCtx, previewChecker) }
		if err := manager.Install(ctx, daemonservice.InstallOptions{Executable: executable, HerdrPath: herdrPath, Verify: verify}); err != nil {
			return printError(stderr, err)
		}
		fmt.Fprintf(stdout, "Installed and started the Herdr Connect user service.\nHerdr: %s\nNext: %s service status\n", herdrPath, executable)
		return 0
	case "status":
		status, err := manager.Status(ctx)
		if errors.Is(err, daemonservice.ErrNotInstalled) {
			if len(args) == 2 {
				_ = writeJSON(stdout, map[string]any{"installed": false, "healthy": false})
			} else {
				fmt.Fprintln(stdout, "Herdr Connect service is not installed.\nNext: herdr-connect service install")
			}
			return 3
		}
		if err != nil {
			return printError(stderr, err)
		}
		preview := previewChecker(ctx)
		sourceOnline, agentCount := inspectHerdr(ctx, status.HerdrPath)
		healthy := status.Running && preview == PreviewRunning && sourceOnline
		report := map[string]any{"installed": status.Installed, "running": status.Running, "healthy": healthy, "pid": status.PID, "manager": status.Manager, "config": status.Config, "herdr_path": status.HerdrPath, "preview_status": preview, "source_online": sourceOnline, "agent_count": agentCount}
		if len(args) == 2 {
			if code := writeJSON(stdout, report); code != 0 {
				return code
			}
		} else {
			fmt.Fprintln(stdout, "Herdr Connect service")
			fmt.Fprintf(stdout, "Installed: yes (%s)\nRunning: %t\n", status.Manager, status.Running)
			if status.PID > 0 {
				fmt.Fprintf(stdout, "PID: %d\n", status.PID)
			}
			fmt.Fprintf(stdout, "Config: %s\nHerdr: %s\nPreview: %s\nSource online: %t\nAgents: %d\n", status.Config, status.HerdrPath, preview, sourceOnline, agentCount)
		}
		if !healthy {
			return 1
		}
		return 0
	case "logs":
		if err := manager.Logs(ctx, stdout, len(args) == 2); err != nil {
			return serviceError(stderr, err)
		}
		return 0
	case "restart":
		if err := manager.Restart(ctx, func(checkCtx context.Context) error { return waitForPreview(checkCtx, previewChecker) }); err != nil {
			return serviceError(stderr, err)
		}
		fmt.Fprintln(stdout, "Restarted the Herdr Connect user service.")
		return 0
	case "uninstall":
		if err := manager.Uninstall(ctx); err != nil {
			return serviceError(stderr, err)
		}
		fmt.Fprintln(stdout, "Stopped and removed the Herdr Connect user service. Database, logs, and binary were preserved.")
		return 0
	default:
		panic("validated service action was not handled: " + action)
	}
}

func validateExecutablePath(path, label string) (string, error) {
	if !filepath.IsAbs(path) {
		absolute, err := filepath.Abs(path)
		if err != nil {
			return "", err
		}
		path = absolute
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("%s executable %s: %w", label, path, err)
	}
	if info.IsDir() || info.Mode()&0o111 == 0 {
		return "", fmt.Errorf("%s path is not executable: %s", label, path)
	}
	return filepath.Clean(path), nil
}

func waitForPreview(ctx context.Context, checker PreviewChecker) error {
	for attempt := 0; attempt < 20; attempt++ {
		if checker(ctx) == PreviewRunning {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(250 * time.Millisecond):
		}
	}
	return errors.New("LAN preview endpoint did not become ready on TCP 9808")
}

func inspectHerdr(ctx context.Context, path string) (bool, int) {
	if path == "" {
		return false, 0
	}
	snapshot, err := herdrsource.NewHerdrCLIAdapterWithBinary(herdrsource.ExecRunner{}, path).Snapshot(ctx)
	if err != nil {
		return false, 0
	}
	return snapshot.Online, len(snapshot.Agents)
}

func serviceError(stderr io.Writer, err error) int {
	if errors.Is(err, daemonservice.ErrNotInstalled) {
		fmt.Fprintln(stderr, "error: Herdr Connect service is not installed. Run 'herdr-connect service install'.")
		return 3
	}
	return printError(stderr, err)
}

func diagnosticsJSON(dbPath string, database *store.Store, state projection.State, syncErr error) map[string]any {
	diagnostics := map[string]any{
		"database": dbPath, "schema_version": database.SchemaVersion(), "source_name": state.SourceName,
		"source_online": state.SourceOnline, "agent_count": len(state.Agents), "through_event_seq": state.ThroughEventSeq,
	}
	if syncErr != nil {
		diagnostics["source_error"] = "source_unavailable"
	}
	return diagnostics
}

func runDoctor(ctx context.Context, stdout io.Writer, args []string, source herdrsource.Source, projector *projection.Projector, database *store.Store, parsed options, previewStatus PreviewStatus) int {
	state, syncErr := projector.Sync(ctx, source)
	if syncErr != nil {
		caps, capsErr := source.Capabilities(ctx)
		if capsErr == nil {
			state, _ = projector.Load(ctx, source.Name(), false, caps)
		}
	}
	report := map[string]any{
		"database": map[string]any{"ok": true, "path": parsed.dbPath, "schema_version": database.SchemaVersion()},
		"source":   map[string]any{"ok": syncErr == nil && state.SourceOnline, "name": source.Name(), "online": syncErr == nil && state.SourceOnline, "agent_count": len(state.Agents)},
		"preview":  map[string]any{"ok": previewStatus != PreviewOccupied, "port": 9808, "status": previewStatus},
	}
	if syncErr != nil || !state.SourceOnline {
		report["next_step"] = "Install or start Herdr, confirm 'herdr agent list' works, then run 'herdr-connect doctor' again."
	} else if len(state.Agents) == 0 {
		report["next_step"] = "Start at least one Herdr Agent, confirm it appears in 'herdr agent list', then run 'herdr-connect doctor' again."
	} else if previewStatus == PreviewRunning {
		report["next_step"] = "The LAN preview is already running. Open Herdr Connect on a device connected to the same trusted LAN."
	} else if previewStatus == PreviewOccupied {
		report["next_step"] = "Stop the other process using TCP 9808, then run 'herdr-connect doctor' again. On macOS/Linux, inspect it with: lsof -nP -iTCP:9808 -sTCP:LISTEN"
	} else if runningFromGoBuild() {
		report["next_step"] = "Build or install the persistent binary, then run 'herdr-connect service install'. For a foreground source preview, run 'go run ./cmd/herdr-connect --source herdr demo-lan'."
	} else {
		report["next_step"] = fmt.Sprintf("Ready. Run '%s service install' to install and start the background service.", suggestedInvocation())
	}
	if len(args) == 1 {
		returnCode := writeJSON(stdout, report)
		if returnCode != 0 {
			return returnCode
		}
	} else {
		fmt.Fprintln(stdout, "Herdr Connect doctor")
		fmt.Fprintf(stdout, "[OK] Database: %s (schema v%d)\n", parsed.dbPath, database.SchemaVersion())
		if syncErr != nil || !state.SourceOnline {
			fmt.Fprintln(stdout, "[FAIL] Herdr CLI/source: unavailable or incompatible")
		} else {
			fmt.Fprintf(stdout, "[OK] Herdr CLI/source: %s is online\n", source.Name())
			if len(state.Agents) == 0 {
				fmt.Fprintln(stdout, "[WARN] Agents: none found")
			} else {
				fmt.Fprintf(stdout, "[OK] Agents: %d found\n", len(state.Agents))
			}
		}
		switch previewStatus {
		case PreviewRunning:
			fmt.Fprintln(stdout, "[OK] LAN preview: already running on TCP 9808")
		case PreviewOccupied:
			fmt.Fprintln(stdout, "[FAIL] LAN preview port: TCP 9808 is already in use by another process")
		default:
			fmt.Fprintln(stdout, "[OK] LAN preview port: TCP 9808 is available")
		}
		fmt.Fprintf(stdout, "Next: %s\n", report["next_step"])
	}
	if syncErr != nil || !state.SourceOnline || len(state.Agents) == 0 || previewStatus == PreviewOccupied {
		return 1
	}
	return 0
}

func checkPreview(ctx context.Context) PreviewStatus {
	certPath := filepath.Join(filepath.Dir(defaultDBPath()), lanauth.CertFileName)
	return checkPreviewAt(ctx, demolan.DefaultAddress, []string{"https://127.0.0.1:9808" + demolan.Path, "https://[::1]:9808" + demolan.Path}, certPath)
}

func checkPreviewAt(ctx context.Context, address string, endpoints []string, certPath string) PreviewStatus {
	// 本机回环探活不发送凭据。证书存在时 pin 本地 Installation 身份；首次启动前
	// 尚无证书时，仅以版本标记识别既有进程，保留 service install 的占用检测语义。
	tlsConfig := &tls.Config{InsecureSkipVerify: true}
	if verify := previewCertificateVerifier(certPath); verify != nil {
		tlsConfig.VerifyPeerCertificate = verify
	}
	transport := &http.Transport{Proxy: nil, TLSClientConfig: tlsConfig}
	client := &http.Client{Timeout: 500 * time.Millisecond, Transport: transport}
	defer transport.CloseIdleConnections()
	for _, endpoint := range endpoints {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			continue
		}
		response, err := client.Do(request)
		if err != nil {
			continue
		}
		var marker struct {
			APIVersion *int `json:"api_version"`
		}
		decodeErr := json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&marker)
		_ = response.Body.Close()
		if response.Header.Get("X-Herdr-Connect-Api-Version") != "" || (decodeErr == nil && marker.APIVersion != nil) {
			return classifyPreview(true, nil)
		}
	}
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return classifyPreview(false, err)
	}
	_ = listener.Close()
	return classifyPreview(false, nil)
}

func previewCertificateVerifier(certPath string) func([][]byte, [][]*x509.Certificate) error {
	certificatePEM, err := os.ReadFile(certPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return func([][]byte, [][]*x509.Certificate) error {
			return fmt.Errorf("read local LAN certificate: %w", err)
		}
	}
	block, _ := pem.Decode(certificatePEM)
	if block == nil || block.Type != "CERTIFICATE" {
		return func([][]byte, [][]*x509.Certificate) error {
			return errors.New("parse local LAN certificate: invalid PEM certificate")
		}
	}
	want := sha256.Sum256(block.Bytes)
	return func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
		if len(rawCerts) == 0 {
			return errors.New("LAN endpoint did not present a certificate")
		}
		if sha256.Sum256(rawCerts[0]) != want {
			return errors.New("LAN endpoint certificate fingerprint does not match local identity")
		}
		return nil
	}
}

func classifyPreview(endpointRunning bool, bindErr error) PreviewStatus {
	if endpointRunning {
		return PreviewRunning
	}
	if bindErr != nil {
		return PreviewOccupied
	}
	return PreviewAvailable
}

func suggestedInvocation() string {
	executable, err := os.Executable()
	if err != nil {
		return "herdr-connect"
	}
	cleaned := filepath.Clean(executable)
	if strings.Contains(cleaned, string(filepath.Separator)+"go-build") {
		return "go run ./cmd/herdr-connect"
	}
	if strings.HasSuffix(cleaned, ".test") {
		return "herdr-connect"
	}
	if strings.ContainsAny(cleaned, " \t") {
		return fmt.Sprintf("%q", cleaned)
	}
	return cleaned
}

func runningFromGoBuild() bool {
	executable, err := os.Executable()
	return err == nil && strings.Contains(filepath.Clean(executable), string(filepath.Separator)+"go-build")
}

func isCommand(command string) bool {
	for _, candidate := range commandNames {
		if command == candidate {
			return true
		}
	}
	return false
}

func isHelpTopic(command string) bool {
	return command == "help" || command == "version" || isCommand(command)
}

func suggestCommand(command string) string {
	best, bestDistance := "", 3
	for _, candidate := range append([]string{"help", "version"}, commandNames...) {
		if distance := editDistance(command, candidate); distance < bestDistance {
			best, bestDistance = candidate, distance
		}
	}
	return best
}

func editDistance(left, right string) int {
	previous := make([]int, len(right)+1)
	for index := range previous {
		previous[index] = index
	}
	for i, l := range left {
		current := make([]int, len(right)+1)
		current[0] = i + 1
		for j, r := range right {
			cost := 0
			if l != r {
				cost = 1
			}
			current[j+1] = min(current[j]+1, previous[j+1]+1, previous[j]+cost)
		}
		previous = current
	}
	return previous[len(right)]
}

func normalizedVersion(version string) string {
	if strings.TrimSpace(version) == "" {
		return DevelopmentVersion
	}
	return version
}

func writeTopHelp(writer io.Writer) {
	fmt.Fprint(writer, `Herdr Connect exposes a Herdr installation to devices on the same trusted LAN.

Usage:
  herdr-connect [global options] <command> [command options]
  herdr-connect help [command]

Commands:
  doctor        Check Herdr, Agents, and the local database; show the next step
  service       Install and manage the background LAN preview service
  demo-lan      Start the LAN server (self-signed TLS, paired devices only)
  pair          Pair a device by showing a scannable QR code
  devices       List and revoke paired devices
  diagnostics   Print backward-compatible diagnostics JSON
  status        Print the projected source state as JSON
  agents        Print the current Agent list as JSON
  capabilities  Print source capabilities as JSON
  migrations    Open the database and print its schema version
  daemon        Continuously synchronize local state
  trace         Run the fake-source lifecycle trace (development only)
  version       Print the build version
  help          Show this help or help for one command

Global options:
  --source herdr|fake   Source adapter (default: herdr)
  --db PATH             SQLite database path (default: user config directory)
  -h, --help            Show help
  --version             Print the build version

Examples:
  herdr-connect doctor
  herdr-connect service install
  herdr-connect service status
  herdr-connect --source herdr demo-lan
  herdr-connect pair
  herdr-connect diagnostics
  herdr-connect help demo-lan

Safety:
  The LAN server uses self-signed TLS and paired-device authentication: a device
  must complete QR pairing before it can read output or send input. Use it on a
  trusted, controlled LAN and revoke devices you no longer use. Discovery proves
  only reachability; it does not establish trust or grant access.
`)
}

func writeCommandHelp(writer io.Writer, command string) {
	usage := map[string]string{
		"help":         "help [command]\n  Show top-level help or detailed help for one command.",
		"version":      "version\n  Print the release version, or 'development' for a local build.",
		"doctor":       "doctor [--json]\n  Check Herdr CLI/source availability, Agent count, database health, and TCP 9808.\n  Human-readable by default; --json is intended for new automation.",
		"service":      "service <install|status|logs|restart|uninstall> [options]\n  Manage the owner-level LaunchAgent or systemd user service.\n  Run 'herdr-connect help service install' for action-specific help.",
		"demo-lan":     "demo-lan\n  Start the LAN server on TCP 9808 (self-signed TLS) and advertise _herdr-connect._tcp.\n  Only paired devices can read output or send input; trusted, controlled LANs only.",
		"diagnostics":  "diagnostics [--json]\n  Print the established diagnostics JSON shape. --json is accepted explicitly\n  without changing the backward-compatible default.",
		"pair":         "pair\n  Issue a one-time pairing secret, print a scannable QR code, and wait until\n  a device completes pairing. Requires a running 'demo-lan' daemon.",
		"devices":      "devices <list|revoke <device_id>>\n  List all paired devices or revoke a device by its device_id.\n  Revocation is immediate and persistent; the revoked token is rejected on the next request.",
		"status":       "status\n  Synchronize and print the complete projected source state as JSON.",
		"agents":       "agents\n  Synchronize and print the current Agent list as JSON.",
		"capabilities": "capabilities\n  Print the selected source adapter's capabilities as JSON.",
		"migrations":   "migrations\n  Open/check the SQLite database and print its schema version as JSON.",
		"daemon":       "daemon [--once]\n  Synchronize every two seconds; --once performs one synchronization.",
		"trace":        "trace\n  Run a deterministic lifecycle trace. Requires --source fake.",
	}
	fmt.Fprintf(writer, "Usage: herdr-connect [--source herdr|fake] [--db PATH] %s\n\n%s\n", usage[command], commandFooter(command))
}

func writeServiceHelp(writer io.Writer, action string) {
	usage := map[string]string{
		"install":   "service install [--herdr ABSOLUTE_PATH]\n  Create or atomically update the owner-level service, start it, and verify TCP 9808.",
		"status":    "service status [--json]\n  Report manager state, PID, endpoint, Herdr source, Agent count, and configured paths.",
		"logs":      "service logs [--tail]\n  Show the latest 100 lines; --tail continues until interrupted.",
		"restart":   "service restart\n  Restart the installed service and verify its LAN preview endpoint.",
		"uninstall": "service uninstall\n  Stop and remove the service while preserving the binary, database, and logs.",
	}
	fmt.Fprintf(writer, "Usage: herdr-connect %s\n\nRun 'herdr-connect help service' for the complete service lifecycle.\n", usage[action])
}

func commandFooter(command string) string {
	if command == "demo-lan" {
		return "Example:\n  herdr-connect --source herdr demo-lan"
	}
	return "Run 'herdr-connect help' to see all commands and the LAN safety boundary."
}

func runTrace(ctx context.Context, stdout, stderr io.Writer, source herdrsource.Source, projector *projection.Projector) int {
	fake, ok := source.(*herdrsource.Fake)
	if !ok {
		return printError(stderr, fmt.Errorf("trace requires the fake Herdr source"))
	}
	states := make([]projection.State, 0, 4)
	state, err := projector.Sync(ctx, fake)
	if err != nil {
		return printError(stderr, err)
	}
	states = append(states, state)
	steps := []struct {
		state   herdrsource.InteractionState
		outcome *herdrsource.TurnOutcome
	}{
		{state: herdrsource.InteractionBlocked}, {state: herdrsource.InteractionReadyInput},
		{state: herdrsource.InteractionUnknown, outcome: outcome(herdrsource.OutcomeSucceeded)},
	}
	for index, step := range steps {
		revision := uint64(index + 2)
		fake.Append(herdrsource.ChangeBatch{AfterCursor: fmt.Sprintf("%d", revision), Changes: []herdrsource.Change{{Kind: herdrsource.ChangeUpsert, Agent: herdrsource.AgentObservation{SourceID: "fake-agent-1", DisplayName: "Fake Agent", TurnID: "turn-1", Revision: revision, InteractionState: step.state, TurnOutcome: step.outcome}}}})
		state, err = projector.Sync(ctx, fake)
		if err != nil {
			return printError(stderr, err)
		}
		states = append(states, state)
	}
	return writeJSON(stdout, map[string]any{"tracer": "complete", "states": states})
}

func runDaemon(ctx context.Context, stdout, stderr io.Writer, source herdrsource.Source, projector *projection.Projector, once bool) int {
	for {
		state, err := projector.Sync(ctx, source)
		if err != nil {
			fmt.Fprintln(stderr, "source_unavailable")
			caps, capsErr := source.Capabilities(ctx)
			if capsErr == nil {
				if offline, loadErr := projector.Load(ctx, source.Name(), false, caps); loadErr == nil {
					_ = json.NewEncoder(stdout).Encode(map[string]any{"source_online": offline.SourceOnline, "agent_count": len(offline.Agents), "through_event_seq": offline.ThroughEventSeq})
				}
			}
		} else if err := json.NewEncoder(stdout).Encode(map[string]any{"source_online": state.SourceOnline, "agent_count": len(state.Agents), "through_event_seq": state.ThroughEventSeq}); err != nil {
			return 1
		}
		if once {
			if err != nil {
				return 1
			}
			return 0
		}
		select {
		case <-ctx.Done():
			return 0
		case <-time.After(2 * time.Second):
		}
	}
}

func outcome(value herdrsource.TurnOutcome) *herdrsource.TurnOutcome { return &value }

func writeJSON(writer io.Writer, value any) int {
	encoder := json.NewEncoder(writer)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		return 1
	}
	return 0
}

func printError(stderr io.Writer, err error) int { fmt.Fprintf(stderr, "error: %v\n", err); return 1 }

func printDemoLANError(stderr io.Writer, err error) int {
	if errors.Is(err, syscall.EADDRINUSE) {
		return printError(stderr, errors.New("TCP port 9808 is already in use; run 'herdr-connect doctor' to check whether the preview is already running"))
	}
	return printError(stderr, err)
}

func defaultDBPath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "herdr-connect.db"
	}
	return filepath.Join(dir, "herdr-connect", "daemon.db")
}
