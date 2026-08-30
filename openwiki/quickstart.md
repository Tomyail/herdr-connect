---
type: Project Overview
title: Herdr Connect
description: Local-first companion for Herdr that enables LAN discovery and control of AI agents from mobile devices
tags: [herdr, lan-discovery, mobile, ios, react-native, go]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-30T21:43:29.677Z
sources:
  - id: openwiki-source-7e2feff63ac717cadd6c55fa
    resource: repo://.github/workflows/android-release.yml
  - id: openwiki-source-39c3295efc089133e87a9c80
    resource: repo://CONTEXT.md
  - id: openwiki-source-570db0334c73da0ce96799d8
    resource: repo://docs/maintainers/releasing.md
  - id: openwiki-source-54ceaf4a4a761305b1ea1256
    resource: repo://docs/protocol/v1.md
  - id: openwiki-source-4d337f0c7fd897a8626e5c73
    resource: repo://docs/security/lan-tls-pairing.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "openwiki/0.4.3", at: "2026-08-30T21:43:29.677Z" }
---

# Herdr Connect

Herdr Connect is an experimental, local-first companion for [Herdr](https://github.com/ogulcancelik/herdr) that enables mobile devices to discover and interact with AI agents running on the same local network. All LAN communication is secured with TLS (self-signed certificate with fingerprint pinning) and per-device bearer tokens obtained through a QR-code [pairing flow](protocol/secure-pairing.md).

## What This Is

Herdr Connect consists of three main components:

1. **Go Daemon** — A background service that communicates with the Herdr CLI, maintains a local projection of agent state, serves an HTTPS API with bearer-token auth, and advertises itself on the LAN via Bonjour/mDNS
2. **iOS Mobile Client** — A React Native app that discovers the daemon, pairs via QR code, and interacts with agents (view output, switch focus, send text, interrupt)
3. **Protocol Package** — TypeScript/Go cryptographic primitives for future end-to-end encryption over remote relay connections (research phase, not yet integrated)

The daemon runs as a persistent service on macOS/Linux and communicates with Herdr through its CLI interface, parsing JSON output to track agents without embedding or linking Herdr source code.

## What This Is Not

Herdr Connect is **not**:

- A production-ready remote access product
- A cloud service or account system
- An end-to-end encrypted communication channel (E2EE is planned for the relay milestone)
- A replacement for Herdr itself — it requires a separate Herdr installation

All LAN communication is encrypted with TLS (self-signed certificate with fingerprint pinning) and authenticated with per-device bearer tokens obtained through [pairing](protocol/secure-pairing.md). There is no end-to-end encryption layer yet — TLS terminates at the daemon.

## Current Scope

Supported features:

- ✅ Bonjour/mDNS daemon advertisement as `_herdr-connect._tcp` (with certificate fingerprint in TXT record)
- ✅ TLS HTTPS server with self-signed certificate and SHA-256 fingerprint pinning
- ✅ QR-code [pairing](protocol/secure-pairing.md) with one-time secret and per-device bearer tokens (`pair --host` selects a specific interface, e.g. for Tailscale pairing)
- ✅ Device management: list paired devices, revoke devices (`herdr-connect devices` CLI)
- ✅ Per-endpoint rate limiting (token bucket: reads, writes, pairing)
- ✅ Snapshot caching and coalescing (1-second TTL with singleflight)
- ✅ iOS discovery on physical devices (TestFlight beta available)
- ✅ Agent list display with status indicators
- ✅ View recent agent output (last 120 lines)
- ✅ Switch focus to an agent
- ✅ Send text input to an agent
- ✅ Interrupt a running agent
- ✅ Real-time status push via SSE for foreground UI freshness
- ✅ API version negotiation with daemon/app upgrade prompts
- ✅ Foreground local notifications, haptics, and completion chime on agent finish
- ✅ Localized UI (English and Chinese)
- ✅ Light/dark theme
- ✅ App Store screenshot pipeline — fixture-driven simulator captures (English + 简体中文, iPhone + iPad) composed into localized marketing frames via `pnpm screenshots`, with no live daemon or real credentials involved
- ✅ Android release workflow (builds APK/AAB against an existing release tag) — present but dormant pending signing secrets

Not yet implemented:

- ❌ Published Android app — an Android release workflow exists (`workflow_dispatch` only) but the release keystore signing secrets (`ANDROID_KEYSTORE_BASE64` etc.) are not yet configured, so tag-triggered automation is disabled and the pipeline is dormant
- ❌ End-to-end encryption (HPKE-based protocol exists but is not yet integrated)
- ❌ Remote connections outside LAN (relay milestone)
- ❌ Remote push notifications (APNs/Expo Push)

## Documentation Structure

Start here for project context, then explore specific areas:

- **[Architecture Overview](architecture/overview.md)** — System components, data flow, security model, and design principles
- **[Herdr Source Adapters](domain/herdr-source-adapters.md)** — How the daemon interfaces with Herdr CLI
- **[Agent Projection](domain/agent-projection.md)** — State synchronization and persistence
- **[CLI Commands](cli/commands.md)** — Daemon management, pairing, device management, and diagnostics
- **[iOS Client](mobile/ios-client.md)** — Mobile app structure, pairing flow, discovery, and interaction
- **[Mobile Release Pipeline](mobile/release-pipeline.md)** — fastlane-free iOS TestFlight releases via `asc`, App Store screenshot generation, and the dormant Android release workflow
- **[Secure Pairing & TLS Protocol](protocol/secure-pairing.md)** — LAN pairing, TLS pinning, device lifecycle, and future E2EE design
- **[Development Setup](development/setup.md)** — Build instructions and development workflow
- **[Testing Guide](development/testing.md)** — Test suites and quality practices

## Quick Links

- **Source Repository**: [github.com/Tomyail/herdr-connect](https://github.com/Tomyail/herdr-connect)
- **Upstream Herdr**: [github.com/ogulcancelik/herdr](https://github.com/ogulcancelik/herdr)
- **User Documentation**: `/docs/` directory (CLI guide, daemon guide, TLS & pairing security model at `/docs/security/lan-tls-pairing.md`)
- **Domain Language**: `/CONTEXT.md` (Chinese — defines project terminology)

## For Future Agents

When updating this documentation:

1. **Preserve the domain language** from `/CONTEXT.md` — use "owner", "installation", "device", "Agent" consistently
2. **Link concepts, not just files** — explain relationships between components before listing source paths
3. **Distinguish LAN security vs. relay roadmap** — TLS + pairing is implemented today; end-to-end encryption and remote relay are future milestones
4. **Ground claims in source** — reference specific Go/TS files when describing implementation details
5. **Keep sections focused** — avoid duplicating content; link to canonical locations instead

Generated by OpenWiki.
