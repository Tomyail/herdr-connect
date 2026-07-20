---
type: Architecture Document
title: System Architecture
description: High-level architecture of Herdr Connect, covering the Go daemon, mobile client, and protocol layers
tags: [architecture, go-daemon, mobile-client, protocol, data-flow]
resource: https://github.com/Tomyail/herdr-connect
---

# System Architecture

Herdr Connect follows a three-tier architecture: the **Herdr CLI** provides raw data, the **Go daemon** projects and serves it, and the **mobile client** discovers and consumes the HTTP API. A separate **protocol package** defines cryptographic primitives for future secure pairing.

## Core Components

```
┌─────────────────────────────────────────────────────────────────┐
│                         Owner's Computer                         │
│                                                                   │
│  ┌──────────────┐         ┌──────────────────┐                  │
│  │   Herdr CLI  │ ─JSON──▶│ Herdr Connect    │                  │
│  │   (separate) │         │ Go Daemon        │                  │
│  └──────────────┘         │                  │                  │
│                            │  ┌────────────┐ │                  │
│                            │  │ Projection │ │                  │
│                            │  │   Layer    │ │                  │
│                            │  └──────┬─────┘ │                  │
│                            │         │       │                  │
│                            │  ┌──────▼─────┐ │                  │
│                            │  │  SQLite    │ │                  │
│                            │  │  Store     │ │                  │
│                            │  └──────┬─────┘ │                  │
│                            │         │       │                  │
│                            │  ┌──────▼─────┐ │                  │
│                            │  │ HTTP Demo  │ │                  │
│                            │  │  Server    │ │                  │
│                            │  └──────┬─────┘ │                  │
│                            └─────────┼───────┘                  │
│                                      │                           │
└──────────────────────────────────────┼───────────────────────────┘
                                       │ mDNS/Bonjour
                                       │ (_herdr-connect._tcp)
┌──────────────────────────────────────┼───────────────────────────┐
│                              iPhone   │                           │
│                                       ▼                           │
│                            ┌──────────────────┐                   │
│                            │  React Native    │                   │
│                            │  Mobile Client   │                   │
│                            │                  │                   │
│                            │  ┌────────────┐ │                   │
│                            │  │ Discovery  │ │                   │
│                            │  │  (Bonjour) │ │                   │
│                            │  └──────┬─────┘ │                   │
│                            │         │       │                   │
│                            │  ┌──────▼─────┐ │                   │
│                            │  │ HTTP       │ │                   │
│                            │  │ Client     │ │                   │
│                            │  └────────────┘ │                   │
│                            └──────────────────┘                   │
└───────────────────────────────────────────────────────────────────┘
```

## Go Daemon

The daemon (`/cmd/herdr-connect/main.go`) is a long-lived service that:

1. **Adapts Herdr CLI output** — The [Herdr Source Adapter](../domain/herdr-source-adapters.md) invokes `herder agent list --json` and parses the response into domain types
2. **Projects agent state** — The [Projection Layer](../domain/agent-projection.md) normalizes source observations and persists them to SQLite
3. **Serves HTTP API** — The demo LAN server (`/internal/demolan/server.go`) exposes agent list, output, focus, and input endpoints on TCP port 9808
4. **Advertises via mDNS** — The daemon publishes a `_herdr-connect._tcp` Bonjour service for mobile discovery

The daemon runs as an owner-level service on macOS (launchd) and Linux (systemd user services). Windows service installation is not supported in the current preview.

### Key Daemon Responsibilities

- **Command execution** — Invokes Herdr CLI commands via `os/exec` and parses JSON output
- **State synchronization** — Calls `source.Snapshot()` periodically and projects changes to SQLite
- **HTTP serving** — Handles demo endpoints with no authentication or encryption
- **Service lifecycle** — Installs, starts, stops, and uninstalls the background service
- **Diagnostics** — Checks database health, source availability, and port readiness

## Mobile Client

The iOS app (`/apps/mobile/`) is a React Native application that:

1. **Discovers the daemon** — Uses `@inthepocket/react-native-service-discovery` to browse `_herdr-connect._tcp` services
2. **Fetches agent state** — Calls `GET /v1/demo/agents` to retrieve the current agent list
3. **Displays status** — Shows agents with interaction state, outcome, and brand icons
4. **Interacts with agents** — Calls `/history`, `/focus`, and `/messages` endpoints for limited control

The client requires an Expo development build due to the native Bonjour module; Expo Go is not sufficient.

### Key Client Screens

- **Agents Screen** (`AgentsScreen.tsx`) — Lists all discovered agents with status pills
- **Agent Detail** (`AgentDetail.tsx`) — Shows recent output, focus switcher, and text input
- **Settings** (`SettingsScreen.tsx`) — Language, appearance, and diagnostic options

## Protocol Package

The protocol package (`/packages/protocol/`) defines cryptographic primitives for **future secure pairing**:

- **HPKE hybrid encryption** — X25519 key exchange, HKDF-SHA256, ChaCha20Poly1305
- **Ed25519 signatures** — For device authentication and message integrity
- **Message types** — SessionHello, PairingRequest, PairingDecision, LifecycleEvent, StateSnapshot, RemoteCommand, etc.
- **Replay protection** — Event-based sequencing and TTL enforcement
- **Error codes** — Well-defined protocol error types

The protocol is **not integrated** into the current LAN demo. It is research for future authenticated and encrypted remote connections.

## Data Flow

### Discovery Flow

1. Mobile client starts Bonjour browsing for `_herdr-connect._tcp`
2. Daemon advertises on port 9808 with TXT record containing demo version
3. Client resolves hostname and port, then calls `GET /v1/demo/agents`
4. Server returns JSON with agent list, source online status, and refreshed timestamp

### State Synchronization Flow

1. Daemon calls `source.Snapshot()` to fetch current agents from Herdr CLI
2. Projection layer normalizes observations and applies batch updates to SQLite
3. Server reads from SQLite on each HTTP request (no long-lived cache)
4. If source is offline, server returns last known state with `source_online: false`

### Interaction Flow

1. User taps agent → Client calls `GET /v1/demo/agents/{sourceId}/history`
2. Server invokes Herdr CLI to read last 120 lines of agent output
3. User sends text → Client calls `POST /v1/demo/agents/{sourceId}/messages`
4. Server invokes Herdr CLI to send text to agent pane and submit Enter

## Design Principles

### Local-First by Default

All state persists locally on the owner's computer. The daemon does not depend on cloud services. Discovery works only on the same LAN segment.

### Unidirectional Projection

The daemon projects Herdr state outward but does not modify Herdr's internal state except through explicit user commands (focus, send message). It does not bidirectionally sync.

### CLI Boundary

Herdr Connect communicates with Herder through its documented CLI interface only. It does not embed Herdr source code, link against Herdr libraries, or call internal APIs.

### Preview Security Boundary

The current demo has **no pairing, no authentication, no encryption**. It exposes terminal output and accepts text input over unencrypted HTTP. This is intentional for the LAN preview scope and will be replaced by the protocol package in future milestones.

## Service Architecture

The daemon runs as an **owner-level service** (not root):

- **macOS**: `~/Library/LaunchAgents/com.tomyail.herdr-connect.plist`
- **Linux**: `~/.config/systemd/user/herdr-connect.service`
- **Windows**: Foreground terminal only (service not supported)

The service resolves absolute paths to both Herdr Connect and Herdr binaries at install time and stores them in the service configuration. Moving or deleting either binary breaks the service.

## Cross-Platform Considerations

### Go Dependencies

- `github.com/grandcat/zeroconf` — mDNS/Bonjour advertising
- `modernc.org/sqlite` — Pure Go SQLite, no CGO
- `golang.org/x/sys` — Platform-specific service installation

### React Native Dependencies

- `@inthepocket/react-native-service-discovery` — Native Bonjour browsing (requires dev build)
- `react-native-mmkv` — Fast local storage for settings
- `@react-navigation/*` — Navigation stack and tab bar

### Platform Support Matrix

| Feature | macOS | Linux | Windows | iOS |
|---------|-------|-------|---------|-----|
| Daemon binary | ✅ | ✅ | ✅ | — |
| Background service | ✅ (launchd) | ✅ (systemd user) | ❌ | — |
| mDNS advertising | ✅ | ✅ | ✅ | — |
| Mobile client | — | — | — | ✅ (TestFlight) |
| Android client | — | — | — | ❌ (planned) |

For implementation details of each component, see their respective domain and development sections.
