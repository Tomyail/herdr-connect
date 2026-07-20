---
type: Protocol Specification
title: Secure Pairing Protocol
description: Cryptographic protocol for authenticated and encrypted remote connections between devices and installations
tags: [protocol, cryptography, hpke, pairing, authentication, encryption]
resource: /packages/protocol
---

# Secure Pairing Protocol

The protocol package (`/packages/protocol/`) defines cryptographic primitives and message formats for **future secure pairing and remote connections**. It is not integrated into the current LAN demo but provides the foundation for authenticated, encrypted, replay-protected communication.

**Status**: Research and development. Not yet used in production.

## Overview

The protocol provides:

- **Hybrid public-key encryption** — HPKE with X25519 key exchange, HKDF-SHA256, ChaCha20Poly1305 AEAD
- **Digital signatures** — Ed25519 for device authentication and message integrity
- **Message sequencing** — Event-based replay protection
- **TTL enforcement** — Automatic expiration of stale messages
- **Well-defined error codes** — Standardized failure modes

## Cipher Suite

The protocol uses a single cipher suite:

```
HPKE-X25519-HKDF-SHA256-CHACHA20POLY1305+Ed25519
```

Components:

- **KEM** — DHKEM-X25519-HKDF-SHA256 (key encapsulation)
- **KDF** — HKDF-SHA256 (key derivation)
- **AEAD** — ChaCha20Poly1305 (authenticated encryption)
- **Signatures** — Ed25519 (authentication)

## Key Types

### Encryption Keys (HPKE)

Each device maintains:

- **Static keypair** — Long-lived X25519 key pair for receiving messages
- **Ephemeral keypair** — Per-session key pair for forward secrecy
- **Remote public keys** — Cached public keys of paired devices

### Signing Keys (Ed25519)

Each device maintains:

- **Static keypair** — Long-lived Ed25519 key pair for signing messages
- **Remote public keys** — Cached signing keys of paired devices

### Key IDs

Each key has a stable identifier:

- `senderSigningKeyId` — Base64url-encoded Ed25519 public key
- `recipientEncryptionKeyId` — Base64url-encoded X25519 public key

## Message Envelope

All encrypted messages use the same envelope structure:

### Header

```typescript
interface Header {
  version?: number;                    // Protocol version (1)
  suite?: string;                      // Cipher suite name
  messageType: MessageType;            // See Message Types
  installationId: string;              // Installation identifier
  senderId: string;                   // Device identifier
  senderSigningKeyId: string;         // Ed25519 public key (base64url)
  senderSigningPublicKey?: Uint8Array; // Raw Ed25519 public key
  recipientId: string;                // Recipient device ID
  recipientEncryptionKeyId: string;   // X25519 public key (base64url)
  messageId: string;                  // Unique message ID
  eventId: string;                    // Event ID for replay protection
  eventSeq: number;                   // Event sequence number
  throughEventSeq: number;            // Last seen event seq
  commandId: string;                  // Command ID (for command messages)
  requestId: string;                  // Request ID (for correlated responses)
  ackSeq: number;                     // Acknowledged sequence number
  createdAt: Date;                    // Message creation time
  expiresAt: Date;                    // Message expiration time
}
```

### Envelope

```typescript
interface Envelope {
  protected: string;  // Base64url-encoded header
  ciphertext: string; // Base64url-encoded ciphertext
  signature: string;  // Base64url-encoded Ed25519 signature
}
```

The envelope is:

1. **Protected** — Header encoded as JSON and base64url-encoded
2. **Encrypted** — Header + plaintext encrypted with HPKE
3. **Signed** — Entire envelope signed with Ed25519

## Message Types

```typescript
enum MessageType {
  SessionHello = "session_hello",
  PairingRequest = "pairing_request",
  PairingDecision = "pairing_decision",
  LifecycleEvent = "lifecycle_event",
  StateSnapshot = "state_snapshot",
  OutputRequest = "output_request",
  OutputSnapshot = "output_snapshot",
  RemoteCommand = "remote_command",
  CommandResult = "command_result",
  Ack = "ack",
  Error = "error",
}
```

### SessionHello

Initial discovery and capability exchange:

```typescript
interface SessionHello {
  installationId: string;
  deviceId: string;
  protocolVersion: number;
  supportedCipherSuites: string[];
  createdAt: Date;
  expiresAt: Date;
}
```

### PairingRequest

Request to pair devices:

```typescript
interface PairingRequest {
  installationId: string;
  deviceId: string;
  deviceName: string;
  deviceType: "ios" | "android" | "desktop";
  pairingToken: string;  // Random token for display
  createdAt: Date;
  expiresAt: Date;
}
```

### PairingDecision

Accept or reject pairing:

```typescript
interface PairingDecision {
  accepted: boolean;
  deviceName?: string;
  rejectionReason?: string;
  createdAt: Date;
}
```

### LifecycleEvent

Agent state change notification:

```typescript
interface LifecycleEvent {
  agentId: string;
  sourceId: string;
  lifecycleRevision: number;
  interactionState: InteractionState;
  turnOutcome?: TurnOutcome;
  eventSeq: number;
  createdAt: Date;
}
```

### RemoteCommand

Execute command on remote installation:

```typescript
interface RemoteCommand {
  commandId: string;
  commandType: "focus_agent" | "send_message" | "interrupt";
  parameters: Record<string, unknown>;
  requestId: string;
  createdAt: Date;
  expiresAt: Date;
}
```

## Replay Protection

Each message includes:

- **eventId** — Unique identifier for the event
- **eventSeq** — Monotonically increasing sequence number
- **throughEventSeq** — Last event seq seen by sender

Recipients:

1. Reject messages with `eventSeq` <= `throughEventSeq`
2. Reject messages with `createdAt` in the future
3. Reject messages with `expiresAt` in the past
4. Track last seen `eventSeq` per sender

This prevents replay attacks even if an attacker captures and re-sends a message.

## Error Codes

```typescript
enum ProtocolErrorCode {
  Replay = "replay",
  TtlExceeded = "ttl_exceeded",
  AuthenticationFailed = "authentication_failed",
  UnsupportedVersion = "unsupported_version",
  UnsupportedSuite = "unsupported_suite",
  Expired = "expired",
  UnsupportedMessageType = "unsupported_message_type",
  InvalidEnvelope = "invalid_envelope",
  InvalidHeader = "invalid_header",
  InvalidKey = "invalid_key",
  WrongRoute = "wrong_route",
  CreatedInFuture = "created_in_future",
  ReplayStoreFailed = "replay_store_failed",
  MessageTooLarge = "message_too_large",
}
```

Errors are returned in `Error` messages with human-readable descriptions.

## Size Limits

- **Max plaintext size** — 256 KiB
- **Max envelope size** — ~300 KiB (after encoding)

Messages exceeding these limits are rejected with `MessageTooLarge`.

## Pairing Flow

### Step 1: Discovery

Device discovers installation via Bonjour (or future relay).

### Step 2: Pairing Request

Device sends `PairingRequest` with:

- Device info (ID, name, type)
- Random pairing token (6-digit string)
- Expiration (usually 5 minutes)

### Step 3: User Confirmation

Installation shows pairing token and asks owner to confirm.

### Step 4: Pairing Decision

Installation sends `PairingDecision`:

- `accepted: true` + device name → Pairing succeeds
- `accepted: false` + rejection reason → Pairing rejected

### Step 5: Key Exchange

Both devices exchange public keys:

- Device sends Ed25519 and X25519 public keys
- Installation sends Ed25519 and X25519 public keys
- Both sides store remote keys for future messages

### Step 6: Encrypted Session

All subsequent messages are:

- Encrypted with recipient's X25519 public key
- Signed with sender's Ed25519 private key
- Protected with replay detection

## Current Limitations

The protocol package is **not yet integrated**:

- No pairing UI in mobile client or daemon
- No key storage or persistence layer
- no integration with HTTP server or client
- Conformance tests exist but are not run in CI

Future work:

1. Implement key storage (SQLite for daemon, MMKV for mobile)
2. Add pairing screens to mobile app
3. Replace HTTP demo endpoints with protocol messages
4. Implement relay for remote access
5. Add push notifications for wake-on-demand

## Security Considerations

### Forward Secrecy

The protocol uses ephemeral HPKE keypairs per session. Compromise of long-term keys does not decrypt past sessions.

### Replay Protection

Event-based sequencing prevents replay attacks. Each message includes `eventSeq` and `throughEventSeq`, and recipients reject duplicates or old messages.

### Key Compromise

If Ed25519 signing key is compromised:

- Attacker can impersonate the device
- Cannot decrypt past messages (ephemeral keys)
- Remedy: revoke key and re-pair

If X25519 encryption key is compromised:

- Attacker can decrypt future messages
- Cannot decrypt past messages (ephemeral keys)
- Remedy: rotate key and re-pair

### Future Post-Quantum

The current cipher suite is **not post-quantum secure**. X25519 and Ed25519 are vulnerable to quantum cryptanalysis. Future versions may add:

- Post-quantum KEM (e.g., Kyber)
- Post-quantum signatures (e.g., Dilithium, SPHINCS+)

## Testing

Conformance tests verify:

- Envelope encoding/decoding
- HPKE encryption/decryption
- Ed25519 signature verification
- Replay protection
- TTL enforcement
- Error handling

Run with:

```sh
pnpm test:conformance
```

See `/test/conformance.test.mjs` for test cases.

## Resources

- **Specification** — `/docs/protocol/v1.md`
- **Conformance** — `/docs/protocol/conformance.md`
- **Source** — `/packages/protocol/src/index.ts`
- **Tests** — `/test/conformance.test.mjs`
