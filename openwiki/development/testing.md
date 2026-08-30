---
type: Testing Guide
title: Development Testing
description: Test suites across Go internal packages, TypeScript mobile unit tests, protocol conformance tests, and integration scripts, with how to run each suite and what invariants it protects.
tags: [testing, conformance, unit-tests, integration-tests, mobile, protocol]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-30T21:43:29.677Z
sources:
  - id: openwiki-source-e86fe7b76c693666bc2cb828
    resource: repo://apps/mobile/package.json
  - id: openwiki-source-15c3610f95e73a659cefda30
    resource: repo://apps/mobile/src/agent-favorites.test.ts
  - id: openwiki-source-acf237d40aa5df5bc7e1e02a
    resource: repo://apps/mobile/src/discovery-match.test.ts
  - id: openwiki-source-f93667697c045439aca100ee
    resource: repo://apps/mobile/src/host-fallback.test.ts
  - id: openwiki-source-a3a6872bfc7c8d71f7022f7c
    resource: repo://apps/mobile/src/instance-alias.test.ts
  - id: openwiki-source-3df1eba041f61065a6fd9e51
    resource: repo://apps/mobile/src/instance-revocation.test.ts
  - id: openwiki-source-f892fa577cc0f42221234c33
    resource: repo://apps/mobile/src/instance-ui-state.test.ts
  - id: openwiki-source-2f85d3d47bf1192c20cea1cb
    resource: repo://apps/mobile/src/keychain-write-plan.test.ts
  - id: openwiki-source-3c080d7e526fb30073b717a8
    resource: repo://apps/mobile/src/pairing.test.ts
  - id: openwiki-source-cb02881fb84a5b280aff9dd2
    resource: repo://apps/mobile/src/screenshot-fixtures.test.ts
  - id: openwiki-source-d72f4ac504cc4295762c4136
    resource: repo://apps/mobile/src/session-registry.test.ts
  - id: openwiki-source-e799143838233b0e8981fdbd
    resource: repo://internal/demolan/auth_test.go
  - id: openwiki-source-ba429e1c8db84aa50c809255
    resource: repo://internal/store/permissions_unix_test.go
  - id: openwiki-source-e76dc777eb0d61a030b438de
    resource: repo://internal/store/permissions_windows_test.go
  - id: openwiki-source-6d8c1cdec697aee752bd7c32
    resource: repo://internal/store/store_test.go
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-d7d84306409d5a2bb025542b
    resource: repo://protocol/protocol_test.go
generated: { by: "openwiki/0.4.3", at: "2026-08-30T21:43:29.677Z" }
---

# Development Testing

This guide explains the testing practices for Herdr Connect: the four main test categories, how to run each suite, and the invariants each suite protects. Most suites are deliberately plain — Go's `testing` package and Node's built-in `node:test` runner with `node:assert/strict` — so no bespoke test framework is required.

## Test Overview

The project has five test entrypoints, exposed as pnpm scripts in the root `package.json`:

1. **Go unit tests** (`pnpm test:go`, i.e. `go test ./...`) — daemon-side packages: store, projection, source adapters, LAN auth, demo server, daemon CLI/service.
2. **Protocol package tests** (`pnpm test:ts`) — the `@herdr-connect/protocol` TypeScript package.
3. **Mobile unit tests** (`pnpm test:mobile`) — pure-logic modules of the React Native/Expo app, run under Node with `tsx`.
4. **Conformance tests** (`pnpm test:conformance`) — build the protocol package and run `test/conformance.test.mjs` to verify that the Go and TypeScript implementations agree on the cryptographic envelope format.
5. **Installation script tests** (`pnpm test:install`) — `test/install-script.test.mjs`.

`pnpm test` runs all five in order: `test:go && test:ts && test:mobile && test:conformance && test:install`.

### Mobile suite wiring

The mobile package's `test` script is `node --import tsx --test src/*.test.ts src/i18n/*.test.ts src/notifications/*.test.ts src/theme/*.test.ts modules/pinned-stream/src/*.test.ts` — every test file is a colocated `*.test.ts` next to its module, and adding a new test file inside those directories requires no registration step. Because the runner is Node (not a React Native runtime), tests must target pure functions and reducers, not components or native modules.

## Go Unit Tests

### Store tests (`/internal/store/store_test.go`)

The store suite verifies persistence invariants that the daemon depends on across restarts:

- **Migration idempotence and sequence continuity** — re-opening the same database file runs migrations safely, reports schema version 2, and the monotonically increasing `event_seq` continues from its pre-restart value instead of resetting.
- **Forward-version refusal** — opening a database whose `PRAGMA user_version` is higher than the supported schema fails with a "newer than supported" error rather than corrupting it.
- **Atomic projection batches** — when a batch contains an invalid update, the entire batch rolls back together: `CurrentEventSeq`, the source cursor, and agent rows all stay at their pre-batch values.

### Cross-platform store permission tests

Owner-only database permissions are asserted per platform with build-tag-separated files:

- `permissions_unix_test.go` (`//go:build unix`) asserts the database file mode is exactly `0600` via `os.Stat`. Mode bits are only meaningful on POSIX — Windows does not express access control that way.
- `permissions_windows_test.go` (`//go:build windows`) instead validates the DACL: `prepareSecureDatabase` must produce a **protected** DACL (`SE_DACL_PROTECTED`, so inherited parent-directory ACEs do not apply) containing exactly one ACE that grants the current user, and the operation must be **idempotent** because the daemon calls it on every startup. The comments record a historical failure mode: passing a security descriptor with a stale SACL-present flag made file creation fail with `ERROR_PRIVILEGE_NOT_HELD` for every Windows user, so the test also guards that first creation succeeds.

The unix test is an external `store_test` package; the Windows test is internal (`package store`) because it exercises the unexported `prepareSecureDatabase` helper directly.

### Demo LAN auth tests (`/internal/demolan/auth_test.go`)

The `demolan` auth suite drives the real HTTP handler stack (`secureHandler(NewHandler(source), database, cert)`) through `httptest` against a real store database and a `lanauth` certificate — no mocking of the auth layer:

- Unauthenticated or wrong-token requests get a **structured 401**: an `unauthorized` error code, the `X-Herdr-Connect-Api-Version` header, and an `api_version` field in the body (liveness probes depend on both markers being present even on 401).
- The pairing flow exchanges a one-time `lanauth.NewPairingSecret` for a token + device ID and returns the certificate fingerprint, and the token then authorizes protected endpoints.
- **Pairing secret replay** — the same secret cannot be paired twice (`400 pairing_secret_invalid`).
- **Expired secrets** — an expired pairing secret returns the same unified `pairing_secret_invalid` response.
- **Revocation semantics** — a token revoked server-side via `lanauth.RevokeDevice` returns `401 revoked`, distinct from `unauthorized` for unknown tokens.
- **Self-revocation** (`DELETE /v1/device`, issue #52) — an authenticated device revokes its own token; the device identity comes from the bearer token (no client parameter), the response is `204 No Content`, and the old token immediately returns `401 revoked` on all protected endpoints.

Other `demolan` suites cover rate limiting, the SSE stream, and the base server handler; `daemoncli` has CLI/device/pair/preview tests and `daemonservice`, `herdrsource`, `lanauth`, and `projection` each have their own `_test.go` files.

## Protocol Conformance Tests

### Go protocol tests (`/protocol/protocol_test.go`)

These verify the cryptographic envelope invariants using in-memory fakes (`memoryReplayGuard`, `memoryPairingGuard`) injected through the protocol's guard interfaces:

- **Seal/Open round trip** — a signed and encrypted envelope opens back to the original plaintext with the logical event identity (`EventID`, `EventSeq`) preserved.
- **Replay rejection** — the second `Open` of the same envelope fails with the stable error code `ErrorCodeReplay` via a `ReplayGuard` that tracks seen message IDs.
- **TTL limits** — sealing a `MessageTypeRemoteCommand` with a 31-second validity window fails with `ErrorCodeTTLExceeded`; remote commands are capped at 30 seconds.
- **Tamper resistance** — modified ciphertext fails without leaking an oracle.

### TypeScript conformance

`pnpm test:conformance` builds `@herdr-connect/protocol` and runs `test/conformance.test.mjs` under `node --test`, pinning cross-implementation compatibility between the Go and TypeScript envelope codecs. Run it whenever the wire format changes; both sides must stay byte-compatible.

## Mobile Unit Tests

Mobile tests live next to their modules and follow a plan/reducer style: most tested modules export pure planning functions (e.g. `planSessionSet`, `planKeychainWrites`, `planForgetInstance`) so that orchestration logic is testable without the React Native runtime. Notable suites and what they lock down:

| Suite | Invariants |
| --- | --- |
| `pairing.test.ts` | `parsePairingQRPayload` accepts only a well-formed `{v, fp, hosts, port, secret}` object and throws `NetworkError` with code `pairing_qr_invalid` for every malformed shape (non-JSON, null, arrays, missing/mistyped fields, empty hosts/secret, non-integer or non-positive port). `pairingUrls` preserves daemon-given host order, brackets IPv6, and uses the payload's port. |
| `agent-favorites.test.ts` | Favorites set toggling, pruning of dangling `source_id`s against a snapshot (empty snapshot does not clear — protects against disconnect wipes), and tolerant serialize/parse round-trips. |
| `instance-alias.test.ts` | Alias normalization (trim, 64-char cap, blank → unnamed), `.local` suffix stripping for mDNS hostnames, and the `defaultInstanceAlias` preference chain: mDNS service name → mDNS hostname → first QR host → fingerprint tail. |
| `instance-revocation.test.ts` | `classifyRevocationFailure` maps 401 → `already_invalid`, transport failures → `unreachable`, other errors → `failed`; `planForgetInstance` removes local credentials silently only when the server side is clean; `planReplacementRevocation` skips when tokens match or no previous credential exists. |
| `instance-ui-state.test.ts` | Per-instance memory of page/selected-agent/filter: selection actions update the current instance without writing memory slots, switching instances remembers old and restores new focus, prune removes unbound instances' slots (returning the same state reference when nothing to prune). |
| `session-registry.test.ts` | `planSessionSet` plans one session per paired instance, replaces sessions on credential or display-field changes, and is an idempotent no-op when nothing changed; `planForegroundTransition` resumes sessions only on return to `active` (brief `inactive` keeps streams alive); `planSessionRetry` retries only `not_found`/`failed` phases. |
| `keychain-write-plan.test.ts` | Keychain write ordering: index before instance keys on add, delete keys before rewriting the index on remove, active-instance pointer always written last, idempotent full replay when model and index agree. |
| `host-fallback.test.ts` | Connection fallback across QR host candidates: transport failures and fingerprint mismatches fall through to the next candidate, application-level `NetworkError`s (business responses) do not, and exhaustion maps the last error via `classify`. |
| `discovery-match.test.ts` | `selectCandidates` prioritizes the service verified for the active instance and excludes services verified as another instance's daemon; `classifyProbeFailure` maps fingerprint mismatch → `wrong_daemon`, transport → `unreachable`, auth (TLS pin passed) → terminal. |
| `screenshot-fixtures.test.ts` | Screenshot launch options accept all deterministic App Store scenes. |

Beyond these, `agent-filter.test.ts` is the largest suite (status-group/workspace/favorites three-dimensional AND filtering and enumeration), and `agent-contract`, `paired-instances`, `history-markdown`, `history-scroll`, i18n (locale/messages — every locale must expose exactly the same UI keys and error-code coverage), notifications (completion chime detection), and theme appearance round out the suite list.

## Related Pages

- [/openwiki/development/setup.md](/openwiki/development/setup.md) — environment setup before running tests.
- [/openwiki/mobile/ios-client.md](/openwiki/mobile/ios-client.md) — the iOS client whose logic modules these tests cover.
