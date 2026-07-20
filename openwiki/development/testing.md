---
type: Testing Guide
title: Development Testing
description: Testing practices, test suites, and conformance requirements for Herdr Connect
tags: [testing, conformance, unit-tests, integration-tests]
---

# Development Testing

This guide explains the testing practices for Herdr Connect, including test suites, conformance requirements, and how to run tests during development.

## Test Overview

The project has four main test categories:

1. **Go unit tests** — Test Go internal packages (projection, store, source adapters)
2. **Protocol conformance tests** — Verify cryptographic protocol behavior
3. **Mobile app tests** — Test React Native components and utilities
4. **Integration tests** — Test end-to-end workflows (install script, demo server)

## Running Tests

### Run All Tests

```sh
pnpm test
```

This runs all test suites in order:

1. Go tests (`go test ./...`)
2. Protocol package tests
3. Mobile app tests
4. Conformance tests
5. Installation script tests

### Run Individual Test Suites

#### Go Tests

```sh
pnpm test:go
# Or directly:
go test ./...
```

#### Protocol Tests

```sh
pnpm test:ts
# Or:
pnpm --filter @herdr-connect/protocol test
```

#### Mobile Tests

```sh
pnpm test:mobile
# Or:
pnpm --filter @herdr-connect/mobile test
```

#### Conformance Tests

```sh
pnpm test:conformance
```

#### Installation Script Tests

```sh
pnpm test:install
```

### Run with Verbose Output

```sh
go test -v ./...
pnpm --filter @herdr-connect/protocol test -- --watch
```

## Go Unit Tests

### Projection Tests

`/internal/projection/projection_test.go` tests the projection layer:

- **Normalization** — Converting source observations to agent records
- **Lifecycle revisions** — Monotonic incrementing of revisions
- **Batch application** — Upserts, removals, and authoritative snapshots
- **Load vs. sync** — Serving stale state vs. syncing fresh data

Example:

```go
func TestProjectionSync(t *testing.T) {
    source := herdrsource.NewFake("test", caps, snapshot)
    projector := projection.New(database)
    
    state, err := projector.Sync(ctx, source)
    
    assert.NoError(t, err)
    assert.Equal(t, 2, len(state.Agents))
}
```

### Store Tests

`/internal/store/store_test.go` tests SQLite persistence:

- **Migration** — Schema versioning and upgrades
- **ApplyProjectionBatch** — Atomic writes of agent updates/removals
- **Permissions** — File permissions on Unix and Windows

Example:

```go
func TestApplyProjectionBatch(t *testing.T) {
    store := createStore(t)
    batch := store.ProjectionBatch{
        SourceName: "herdr",
        Updates: []store.AgentUpdate{...},
        ObservedSourceIDs: map[string]struct{}{"agent-1": {}},
    }
    
    err := store.ApplyProjectionBatch(ctx, batch)
    
    assert.NoError(t, err)
}
```

### Source Adapter Tests

`/internal/herdrsource/source_test.go` tests Herdr CLI integration:

- **Fake source** — Synthetic agents for development
- **Herdr CLI adapter** — Mocked Herdr output parsing
- **Capability negotiation** — Correct capability reporting
- **Interrupt** — `AgentInterrupter` interface implementation

### LAN Auth Tests

`/internal/lanauth/lanauth_test.go` tests the LAN authentication layer:

- **Certificate generation** — Self-signed ECDSA P-256 cert creation, fingerprint computation
- **Pairing secret lifecycle** — Issue, consume, expire, reject replay
- **Device authentication** — Three-state auth (OK, missing, revoked)
- **Device revocation** — Idempotent revoke, status detection

### Demo LAN Auth & Rate Limit Tests

`/internal/demolan/auth_test.go` and `/internal/demolan/rate_limit_test.go` test:

- **Bearer token validation** — Auth middleware extracts and validates tokens
- **Revoked vs. missing distinction** — Correct HTTP status mapping (`401 revoked` vs. `401 unauthorized`)
- **Rate limiting** — Token bucket per-device (read/write) and per-IP limits, `429` responses
- **Pairing endpoint** — `/v1/pair` secret consumption and token issuance

### Pairing & Device CLI Tests

`/internal/daemoncli/pair_test.go` and `/internal/daemoncli/devices_test.go` test:

- **Pair command** — QR payload generation, secret creation, polling loop
- **Devices command** — List and revoke subcommands, JSON output formatting
- **Dependency injection** — `pairDeps` seams for testable CLI logic

### Store Pairing Tests

`/internal/store/pairing_test.go` and `/internal/store/migrate_internal_test.go` test:

- **Schema v2 migration** — `paired_devices` and `pairing_secrets` table creation
- **CompletePairing transaction** — Conditional secret consumption with WAL deadlock avoidance
- **Device CRUD** — Insert, list, revoke, touch `last_seen_at_ms`

## Protocol Conformance Tests

`/test/conformance.test.mjs` tests the cryptographic protocol:

### Envelope Encoding/Decoding

- Serializing headers to JSON
- Base64url-encoding protected headers
- Parsing envelopes from wire format

### HPKE Encryption/Decryption

- Generating ephemeral keypairs
- Encap/decap with X25519
- ChaCha20Poly1305 AEAD encryption
- Handling empty plaintext

### Ed25519 Signatures

- Signing envelopes
- Verifying signatures with public keys
- Rejecting invalid signatures

### Replay Protection

- Rejecting duplicate `eventSeq`
- Rejecting messages with `eventSeq` <= `throughEventSeq`
- Tracking per-sender state

### TTL Enforcement

- Rejecting messages with `expiresAt` in the past
- Rejecting messages with `createdAt` in the future
- Accepting messages within TTL window

### Error Handling

- All protocol error codes are testable
- Error messages include code and human-readable description
- `ProtocolError` type is used consistently

Example test:

```javascript
test("rejects replay messages", async () => {
  const envelope = await encodeEnvelope(...);
  const result = await decodeEnvelope(envelope, state);
  
  // First acceptance
  assert.equal(result.error, undefined);
  
  // Second rejection (replay)
  const result2 = await decodeEnvelope(envelope, state);
  assert.equal(result2.error.code, "replay");
});
```

## Mobile App Tests

### Component Tests

`/apps/mobile/src/*.test.ts` tests React Native components:

- **AgentBrandIcon** — Icon detection and color extraction
- **Agent status formatting** — State to human-readable text
- **History scroll logic** — Scroll position preservation
- **Pairing** — QR payload parsing, URL construction (`pairing.test.ts`)
- **Discovery lifecycle** — Bonjour discovery start/stop/cleanup (`discovery-lifecycle.test.ts`)

### Theme Tests

`/apps/mobile/src/theme/*.test.ts` tests theming:

- **Color derivation** — Extracting accent colors from brand icons
- **Theme application** — Light vs. dark mode colors

### Localization Tests

`/apps/mobile/src/i18n/*.test.ts` tests translations:

- **English translations** — All required keys exist
- **Chinese translations** — All required keys exist
- **Missing keys** — Fail if translation incomplete

Example:

```typescript
describe("AgentBrandIcon", () => {
  test("detects Claude icon", () => {
    const icon = getAgentIcon("claude-3.5-sonnet");
    expect(icon).toBe("claude");
  });
  
  test("extracts accent color", () => {
    const color = extractAccentColor("claude");
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
```

## Integration Tests

### Installation Script Tests

`/test/install-script.test.mjs` tests the installer:

- **Script download** — Fetches install.sh from GitHub
- **Platform detection** — Detects macOS, Linux, Windows correctly
- **Binary installation** — Installs to correct directory
- **PATH configuration** — Adds to PATH on supported platforms

### Demo Server Tests

`/internal/demolan/server_test.go` tests the LAN HTTPS server:

- **Agent list endpoint** — Returns valid JSON
- **History endpoint** — Truncates to 120 lines
- **Focus endpoint** — Calls source adapter
- **Message endpoint** — Validates message size
- **Interrupt endpoint** — Capability assertion, source interrupt call
- **Snapshot caching** — TTL cache and singleflight coalescing behavior
- **Error handling** — Returns correct error codes

## Test Practices

### Unit Test Style

- **Table-driven tests** — Use Go test tables for multiple cases
- **Golden files** — For complex JSON output (rarely used, prefer assertions)
- **Mocks** — Use fake sources and in-memory databases

### Integration Test Style

- **Deterministic** — Tests should not depend on external state
- **Isolated** — Each test uses a fresh database or source
- **Fast** — Prefer unit tests over slow integration tests

### Protocol Test Style

- **Property-based** — Test invariants (e.g., encrypt/decrypt roundtrip)
- **Error paths** — Test all error codes are reachable
- **Spec compliance** — Tests mirror `/docs/protocol/v1.md` sections

## Continuous Integration

Tests run on GitHub Actions for:

- Pull requests
- Main branch pushes
- Release tags

The CI runs all test suites and fails if any test fails.

### Coverage

Go code coverage is collected but not enforced:

```sh
go test -cover ./...
```

Target coverage is **not yet defined**. Focus on critical paths first:

- Projection normalization and lifecycle revisions
- Store migrations and persistence
- Source adapter parsing
- Protocol envelope encoding/decoding

## Debugging Tests

### Go Tests

Run a single test:

```sh
go test -v -run TestProjectionSync ./internal/projection
```

Run with race detection:

```sh
go test -race ./...
```

### Protocol Tests

Run a single test file:

```sh
node --test test/conformance.test.mjs
```

### Mobile Tests

Run with watch mode:

```sh
pnpm --filter @herdr-connect/mobile test --watch
```

## Writing New Tests

### Go Tests

Add tests next to the code under test:

```
internal/projection/projection.go
internal/projection/projection_test.go
```

Use `testing.T` and standard Go assertions. Example:

```go
func TestNormalizeObservation(t *testing.T) {
  caps := herdrsource.Capabilities{TrustedInteractionState: true}
  obs := herdrsource.AgentObservation{
    SourceID: "agent-1",
    Revision: 1,
    InteractionState: herdrsource.InteractionWorking,
  }
  
  update, err := normalizeObservation(caps, obs)
  
  assert.NoError(t, err)
  assert.NotEmpty(t, update.Record.AgentID)
}
```

### Protocol Tests

Add to `/test/conformance.test.mjs`. Use the `test` function from Node.js test runner:

```javascript
test("encrypts and decrypts message", async () => {
  const plaintext = new TextEncoder().encode("hello");
  const envelope = await encrypt(plaintext);
  const decrypted = await decrypt(envelope);
  
  assert.deepEqual(decrypted, plaintext);
});
```

### Mobile Tests

Add next to the code under test:

```
apps/mobile/src/AgentDetail.tsx
apps/mobile/src/AgentDetail.test.tsx
```

Use React Native Testing Library patterns (not yet adopted — tests currently use plain assertions).

## Known Test Gaps

Areas with minimal or no test coverage:

- **Service installation** — launchd/systemd integration is untested
- **Bonjour discovery** — Mobile discovery flow is untested (requires physical device)
- **HTTP client** — Mobile network layer is untested
- **Concurrent sync** — Projection layer concurrent access is lightly tested
- **Error recovery** — Source reconnection after failures is untested

These gaps are acknowledged but not blocking for the LAN preview milestone. Future work should prioritize:

1. Service installation tests on real macOS/Linux systems
2. Fake Bonjour server for mobile discovery tests
3. HTTP mocking for mobile client tests

## Test Metrics

As of the current version:

- **Go tests** — ~15 tests, pass in <1 second
- **Protocol tests** — ~20 tests, pass in <1 second
- **Mobile tests** — ~10 tests, pass in <1 second
- **Integration tests** — ~5 tests, pass in <5 seconds

Total runtime is under 10 seconds on CI.

## Next Steps

- **Add missing tests** — Focus on service installation and discovery
- **Increase coverage** — Target 80% coverage for Go packages
- **Property-based tests** — Add property tests for protocol invariants
- **E2E tests** — Add tests for full user workflows (install → discover → interact)
