---
type: CLI Reference
title: CLI Commands
description: Complete reference for herdr-connect CLI commands, global options, and service management
tags: [cli, commands, service-management, diagnostics]
resource: /internal/daemoncli
---

# CLI Commands

The `herdr-connect` CLI (`/internal/daemoncli/cli.go`) provides commands for diagnosing the installation, managing the background service, and running the LAN preview. All commands share global options and follow consistent output conventions.

## Global Options

Options must appear before the command name:

```text
--source <name>   Source adapter (herdr|fake). Defaults to herdr.
--db <path>       SQLite database path. Defaults to owner's config directory.
-h, --help        Show help without contacting Herdr or opening SQLite.
--version         Show build version without contacting Herdr or opening SQLite.
```

### Database Path

Default locations by platform:

- **macOS**: `~/Library/Application Support/herdr-connect/daemon.db`
- **Linux**: `~/.config/herdr-connect/daemon.db`
- **Windows**: `%LOCALAPPDATA%\herdr-connect\daemon.db`

Override with `--db` for testing or to run multiple instances.

### Source Selection

- `herdr` — Real Herdr CLI adapter (default)
- `fake` — Fake source for development (see [Herdr Source Adapters](../domain/herdr-source-adapters.md))

## Commands

### doctor

Diagnose the installation and check readiness for LAN preview:

```sh
herdr-connect doctor
herdr-connect doctor --json
```

Checks performed:

1. **Database** — Can SQLite be opened and validated?
2. **Herdr CLI/source** — Is the source reachable and online?
3. **Agents** — Are at least one agent visible?
4. **LAN preview port** — Is TCP 9808 available?

Output format (default):

```text
Herdr Connect doctor
[OK] Database: /home/owner/.config/herdr-connect/daemon.db (schema v1)
[OK] Herdr CLI/source: herdr-cli-v0.7 is online
[OK] Agents: 2 found
[OK] LAN preview port: TCP 9808 is available
Next: Ready. Run '/home/owner/.local/bin/herdr-connect service install' to install and start the background service.
```

Output format (`--json`):

```json
{
  "database": "/home/owner/.config/herdr-connect/daemon.db",
  "schema_version": 1,
  "source_name": "herdr",
  "source_online": true,
  "agent_count": 2,
  "lan_preview_port_available": true,
  "next_command": "/home/owner/.local/bin/herdr-connect service install"
}
```

### service

Manage the background service (macOS/Linux only):

```sh
herdr-connect service install
herdr-connect service status
herdr-connect service logs
herdr-connect service logs --tail
herdr-connect service restart
herdr-connect service uninstall
```

#### service install

Installs and starts the service. Resolves absolute paths to both Herdr Connect and Herdr binaries and stores them in the service configuration. Refuses to overwrite unmanaged service files.

Exit codes:

- `0` — Service installed and started
- `1` — Installation failed (port occupied, binary invalid, etc.)
- `3` — Service already installed (use `service restart` to update)

#### service status

Shows service status and recent log excerpt:

```sh
herdr-connect service status --json
```

Output:

```json
{
  "installed": true,
  "running": true,
  "pid": 12345,
  "port": 9808,
  "since": "2025-01-15T10:30:00Z",
  "recent_logs": "..."
}
```

Exit codes:

- `0` — Service installed and running
- `3` — Service not installed
- `1` — Error reading status

#### service logs

Prints recent logs. By default shows last 100 lines. `--tail` follows new output.

#### service restart

Restarts a running service. Atomically updates configuration if service file was previously created by Herdr Connect.

#### service uninstall

Stops the service and removes managed configuration. Preserves CLI binary, database, and logs.

### demo-lan

Start the LAN preview server in the foreground:

```sh
herdr-connect demo-lan
# Or with explicit source:
herdr-connect --source herdr demo-lan
```

The server:

- Listens on TCP port 9808
- Advertises `_herdr-connect._tcp` via mDNS
- Serves unencrypted HTTP (see [safety boundary](#lan-preview-safety-boundary))
- Logs all requests to stderr

Exit the server with Ctrl+C. The service wrapper runs this command in the background.

### daemon

Run the persistent daemon (used by service wrapper):

```sh
herdr-connect daemon
herdr-connect daemon --once  # Perform one sync and exit
```

The daemon:

- Syncs agent state periodically
- Serves HTTP demo endpoints
- Handles graceful shutdown on SIGINT/SIGTERM

`--once` is useful for health checks in scripts.

### agents

List all agents in the projection:

```sh
herdr-connect agents
```

Output (JSON):

```json
{
  "source_name": "herdr",
  "source_online": true,
  "agents": [
    {
      "agent_id": "abc123",
      "source_id": "pane-42",
      "turn_id": "turn-1",
      "lifecycle_revision": 5,
      "interaction_state": "working",
      "turn_outcome": null
    }
  ]
}
```

### status

Show full projection status:

```sh
herdr-connect status
```

Includes `agents`, `capabilities`, and `through_event_seq`.

### capabilities

Show what the source supports:

```sh
herdr-connect capabilities
```

Output:

```json
{
  "observe_agents": true,
  "incremental_changes": false,
  "trusted_interaction_state": false,
  "trusted_turn_outcome": false,
  "read_output": true,
  "send_prompt": true,
  "interrupt": true
}
```

### diagnostics

Compatibility command for existing scripts. Same output as `status --json` by default.

### migrations

Show database schema version:

```sh
herdr-connect migrations
```

Output:

```json
{
  "database": "/home/owner/.config/herdr-connect/daemon.db",
  "schema_version": 1
}
```

### trace

Development command for tracing source events (not for normal use):

```sh
herdr-connect trace
```

Prints a live stream of agent changes as they occur.

### version

Show build version:

```sh
herdr-connect version
herdr-connect --version
```

Output:

```text
herdr-connect version development
# Or for release builds:
herdr-connect version v0.1.0-preview.2
```

Source builds without release metadata report `development`.

## Output Conventions

### Standard Streams

- **stdout** — JSON output, help text, version information
- **stderr** — Errors, warnings, `doctor` check results

### Exit Codes

- `0` — Success
- `1` — Runtime or health-check failure
- `2` — Invalid command-line usage
- `3` — Service not installed (service lifecycle commands only)

### JSON Output

Most commands support `--json` for structured output. JSON is always single-line and valid even when the command fails (errors are in the JSON response, not in stdout).

### Error Messages

Errors go to stderr and include:

- Error code (machine-readable)
- Human-readable message
- Suggested next steps when applicable

## LAN Preview Safety Boundary

The `demo-lan` server has **no pairing, no authentication, no encryption**. It exposes:

- Recent terminal output from all agents (last 120 lines)
- Ability to send text input to any agent
- Agent metadata (names, states, workspaces)

### Usage Constraints

Run the demo **only** on:

- Trusted local networks (home LAN, controlled office network)
- Networks without client isolation (AP isolation mode disabled)
- Networks without unknown or untrusted devices

### Prohibited Uses

**Never**:

- Run on public Wi-Fi or shared networks
- Enter secrets, passwords, or sensitive data
- Expose the daemon to the internet
- Run while connected to a VPN (VPN may block mDNS)

### Mitigations

- Stop the daemon after testing: `herdr-connect service stop`
- Use firewall rules to restrict inbound connections on port 9808
- Monitor `service logs` for unexpected connections
- Keep the preview session short

Future milestones will replace this with the [Secure Pairing Protocol](../protocol/secure-pairing.md).

## Service Installation Details

### macOS (launchd)

Service file: `~/Library/LaunchAgents/com.tomyail.herdr-connect.plist`

```xml
<key>Label</key>
<string>com.tomyail.herdr-connect</string>
<key>ProgramArguments</key>
<array>
  <string>/absolute/path/to/herdr-connect</string>
  <string>daemon</string>
</array>
<key>RunAtLoad</key>
<true/>
```

Manage with:

```sh
launchctl load ~/Library/LaunchAgents/com.tomyail.herdr-connect.plist
launchctl unload ~/Library/LaunchAgents/com.tomyail.herdr-connect.plist
```

### Linux (systemd user service)

Service file: `~/.config/systemd/user/herdr-connect.service`

```ini
[Unit]
Description=Herdr Connect Daemon
[Service]
ExecStart=/absolute/path/to/herdr-connect daemon
Restart=on-failure
[Install]
WantedBy=default.target
```

Manage with:

```sh
systemctl --user daemon-reload
systemctl --user start herdr-connect
systemctl --user enable herdr-connect
```

### Windows

Background services are not supported. Run in foreground:

```powershell
.\herdr-connect.exe demo-lan
```

Keep the terminal window open while using the mobile app.

## Development Commands

Commands useful for development but not for normal use:

- `--source fake` — Use fake source instead of real Herdr CLI
- `trace` — Print live event stream
- `daemon --once` — Single sync for health checks

See [Development Setup](../development/setup.md) for development workflow.
