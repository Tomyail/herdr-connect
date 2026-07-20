---
type: Developer Guide
title: Development Setup
description: How to build, run, and develop Herdr Connect from source for contributors
tags: [development, setup, build, dependencies, environment]
---

# Development Setup

This guide explains how to set up a development environment for contributing to Herdr Connect. For users who just want to try the preview, see the [main README](../README.md) "Try it in 5 minutes" section.

## Requirements

### For iOS Client Development

- **macOS** with Apple silicon (Intel may work but is untested)
- **Xcode** 16 or later
- **iPhone** physical device (required for testing — Bonjour does not work on simulator)
- **Node.js** 24 (recommended; 22 LTS may work)
- **pnpm** 10.28.1 or later
- **Expo CLI** (`npm install -g expo-cli`)

### For Daemon Development

- **Go** 1.25 or later
- **Herdr CLI** installed and working (`herder agent list` should succeed)

### Common Requirements

- **Git** for cloning the repository
- **Bash** or zsh for running scripts (PowerShell works for Go commands on Windows)

## Repository Structure

```
herdr-connect/
├── cmd/                    # Go entrypoints
│   ├── herdr-connect/     # Main daemon CLI
│   └── protocol-conformance/ # Protocol test CLI
├── internal/               # Go internal packages
│   ├── daemoncli/        # CLI command implementation
│   ├── demolan/          # LAN demo HTTP server
│   ├── herdrsource/      # Herdr source adapters
│   ├── projection/       # Projection layer
│   ├── store/            # SQLite storage
│   └── daemonservice/   # Service installation
├── apps/
│   └── mobile/           # React Native iOS app
├── packages/
│   └── protocol/        # TypeScript protocol implementation
├── test/                # Integration tests
├── docs/                # User-facing documentation
└── skills/             # OpenWiki skills (for repo maintainers)
```

## Initial Setup

### 1. Clone the Repository

```sh
git clone https://github.com/Tomyail/herdr-connect.git
cd herdr-connect
```

### 2. Install Go Dependencies

```sh
go mod download
```

Verify Go version:

```sh
go version  # Should be 1.25 or later
```

### 3. Install JavaScript Dependencies

```sh
corepack enable
pnpm install --frozen-lockfile
```

This installs dependencies for all workspaces (mobile app, protocol package).

### 4. Verify Herdr Installation

```sh
herder agent list
```

You should see at least one agent. If Herdr is not installed, follow the [Herdr installation guide](https://github.com/ogulcancelik/herder).

## Development Workflow

### Run Daemon from Source

```sh
pnpm demo:lan
```

This runs:

```sh
go run ./cmd/herdr-connect --source herdr demo-lan
```

The daemon:

- Listens on TCP port 9808
- Advertises `_herdr-connect._tcp` via mDNS
- Syncs agent state from Herdr CLI
- Logs to stderr

Stop with Ctrl+C.

### Run Fake Source Daemon

For development without Herdr:

```sh
pnpm dev:daemon
```

This runs with `--source fake`, providing two synthetic agents.

### Run Protocol Trace

For debugging agent changes:

```sh
pnpm trace:daemon
```

Prints a live stream of agent lifecycle events.

### Build iOS Development Build

**Note**: This requires an iPhone physical device. The iOS simulator cannot test Bonjour discovery.

#### One-Time Build

First, build the development client:

```sh
pnpm ios:mobile
```

This:

1. Runs `expo prebuild` to generate native iOS project
2. Runs `expo run:ios --device` to build and install on connected iPhone
3. Starts Metro bundler

#### Subsequent Runs

After the first build, start Metro directly:

```sh
pnpm dev:mobile
```

Then open the Herdr Connect app on your iPhone.

### Run Protocol Tests

```sh
pnpm test:conformance
```

This builds the protocol package and runs conformance tests.

### Run All Tests

```sh
pnpm test
```

This runs:

1. Go tests (`go test ./...`)
2. Protocol package tests
3. Mobile app tests
4. Conformance tests
5. Installation script tests

### Type Checking

```sh
pnpm typecheck
```

Checks TypeScript types for protocol and mobile packages.

## Code Organization

### Go Code

The daemon is organized in `/internal/`:

- **Entry** — `/cmd/herdr-connect/main.go` (main function, source factory)
- **CLI** — `/internal/daemoncli/cli.go` (command parsing, execution)
- **Source adapters** — `/internal/herdrsource/` (Herdr CLI interface)
- **Projection** — `/internal/projection/projection.go` (state normalization)
- **Storage** — `/internal/store/store.go` (SQLite persistence)
- **LAN demo** — `/internal/demolan/server.go` (HTTP server)
- **Service** — `/internal/daemonservice/` (launchd/systemd integration)

### TypeScript Code

The mobile app is in `/apps/mobile/`:

- **Entry** — `/apps/mobile/src/App.tsx` (navigation, providers)
- **Screens** — `AgentsScreen.tsx`, `AgentDetail.tsx`, `SettingsScreen.tsx`
- **Connection** — `connection.tsx` (Bonjour discovery, state management)
- **i18n** — `i18n/en.ts`, `i18n/zh-Hans.ts` (translations)
- **Theme** — `theme/ThemeContext.tsx` (theming)

The protocol package is in `/packages/protocol/`:

- **Entry** — `/packages/protocol/src/index.ts` (types, crypto primitives)
- **Tests** — `/test/conformance.test.mjs` (envelope, encryption, signatures)

## Development Tips

### Hot Reloading

- **Go** — No hot reload. Restart the daemon after changes.
- **React Native** — Fast refresh works for most changes. Some navigation/state changes require restart.
- **Protocol** — Rebuild with `pnpm --filter @herdr-connect/protocol build` after changes.

### Debugging Daemon

Add verbose logging by changing log level in `demolan/server.go`. The daemon logs to stderr:

```sh
pnpm demo:lan 2>&1 | tee daemon.log
```

### Debugging Mobile Client

Use React Native Debugger or Flipper for network inspection:

```sh
# Start with debugging enabled
pnpm dev:mobile
```

### Fake Source for UI Development

Use `--source fake` to test UI without Herdr:

```sh
# Daemon
go run ./cmd/herdr-connect --source fake demo-lan

# Mobile (update connection URL if needed)
pnpm dev:mobile
```

### Testing Discovery Without iPhone

Use a Bonjour browser app on macOS:

```sh
# Browse for _herdr-connect._tcp
dns-sd -B _herdr-connect._tcp
```

Or use `avahi-browse` on Linux:

```sh
avahi-browse --terminate _herdr-connect._tcp
```

## IDE Setup

### VS Code

Recommended extensions:

- **Go** — Go extension for gopls
- **TypeScript** — Built-in TypeScript support
- **React Native** — React Native tools
- **YAML** — For OpenWiki docs

### Go Configuration

Ensure `gopls` is installed:

```sh
go install golang.org/x/tools/gopls@latest
```

### TypeScript Configuration

The repo uses workspace protocols. Install `pnpm` and use the workspace TypeScript version:

```sh
corepack enable
pnpm use node@24
```

## Build Releases

### Daemon Release

For macOS/Linux:

```sh
# Build for current platform
go build -o herdr-connect ./cmd/herdr-connect

# Build for multiple platforms
gox -osarch="darwin/amd64 darwin/arm64 linux/amd64" -output="dist/{{.OS}}-{{.Arch}}/herdr-connect" ./cmd/herdr-connect
```

For Windows:

```sh
env GOOS=windows GOARCH=amd64 go build -o herdr-connect.exe ./cmd/herdr-connect
```

### iOS Release Build

See `/docs/release/` for full instructions. Briefly:

```sh
pnpm release:ios:prepare
pnpm release:ios:build
pnpm release:ios:upload
pnpm release:ios:distribute
```

This uses EAS Build and TestFlight.

## Common Issues

### Port 9808 Already in Use

```sh
# Check what's using the port
lsof -i :9808  # macOS/Linux
netstat -ano | findstr :9808  # Windows

# Kill the process or use a different port
```

### Bonjour Discovery Not Working

- Confirm both devices on same Wi-Fi
- Disable VPN temporarily
- Check for client isolation on guest networks
- Verify local network permission in iOS Settings
- Check firewall on macOS (System Settings → Network → Firewall)

### Herdr CLI Not Found

```sh
# Add Herdr to PATH or set environment variable
export HERDR_CONNECT_HERDR_PATH=/absolute/path/to/herder

# Or pass binary path to commands
herdr-connect --source herdr --herdr /path/to/herder demo-lan
```

### Metro Bundler Issues

```sh
# Clear Metro cache
pnpm dev:mobile -- --clear-cache

# Reset node_modules
rm -rf node_modules apps/mobile/node_modules packages/protocol/node_modules
pnpm install --frozen-lockfile
```

### Go Module Errors

```sh
# Clean module cache
go clean -modcache

# Re-download dependencies
go mod download
```

## Contributing

See `/CONTRIBUTING.md` for contribution guidelines. Key points:

- Write tests for new features
- Update OpenWiki docs for architectural changes
- Follow the code organization in `/internal/`
- Use the fake source for unit tests
- Keep the demo LAN endpoint minimal (no pairing, no encryption in current version)

## Next Steps

- **Learn the architecture** — See [Architecture Overview](../architecture/overview.md)
- **Understand the domain** — See [Herdr Source Adapters](../domain/herdr-source-adapters.md) and [Agent Projection](../domain/agent-projection.md)
- **Run tests** — See [Development Testing](../development/testing.md)
- **Read the protocol** — See [Secure Pairing Protocol](../protocol/secure-pairing.md) for future work
