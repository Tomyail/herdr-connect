import assert from "node:assert/strict";
import test from "node:test";

import {
  errorCodeOf,
  generateIdentity,
  MessageType,
  open,
  ProtocolErrorCode,
  signPairingChallenge,
  seal,
  validatePairingCandidate,
  verifyPairingChallenge,
  type ReplayGuard,
} from "../src/index.js";

class MemoryReplayGuard implements ReplayGuard {
  readonly #seen = new Set<string>();

  async markIfNew(messageId: string): Promise<boolean> {
    if (this.#seen.has(messageId)) {
      return false;
    }
    this.#seen.add(messageId);
    return true;
  }
}

test("TypeScript seal/open preserves a lifecycle event", async () => {
  const sender = await generateIdentity();
  const recipient = await generateIdentity();
  const createdAt = new Date("2026-07-15T03:00:00.000Z");
  const header = {
    messageType: MessageType.LifecycleEvent,
    installationId: "ins_01jz7example",
    senderId: "installation_primary",
    senderSigningKeyId: "sign_installation_1",
    recipientId: "device_iphone",
    recipientEncryptionKeyId: "enc_device_1",
    messageId: "msg_01jz7example",
    eventId: "evt_01jz7example",
    eventSeq: 42,
    throughEventSeq: 0,
    commandId: "",
    requestId: "",
    ackSeq: 0,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000),
  } as const;
  const plaintext = new TextEncoder().encode(
    JSON.stringify({ agent_id: "agent_1", interaction_state: "blocked" }),
  );

  const envelope = await seal({
    header,
    plaintext,
    recipientEncryptionPublicKey: recipient.encryptionPublicKey,
    senderSigningPrivateKey: sender.signingPrivateKey,
  });
  const opened = await open({
    envelope,
    recipientEncryptionPrivateKey: recipient.encryptionPrivateKey,
    senderSigningPublicKey: sender.signingPublicKey,
    expectedInstallationId: header.installationId,
    expectedSenderId: header.senderId,
    expectedRecipientId: header.recipientId,
    now: new Date(createdAt.getTime() + 60_000),
    replayGuard: new MemoryReplayGuard(),
  });

  assert.deepEqual(opened.plaintext, plaintext);
  assert.equal(opened.header.eventId, header.eventId);
  assert.equal(opened.header.eventSeq, header.eventSeq);
});

test("TypeScript open rejects a replay with a stable code", async () => {
  const sender = await generateIdentity();
  const recipient = await generateIdentity();
  const createdAt = new Date("2026-07-15T03:00:00.000Z");
  const header = {
    messageType: MessageType.LifecycleEvent,
    installationId: "ins_replay",
    senderId: "installation_primary",
    senderSigningKeyId: "sign_installation_1",
    recipientId: "device_iphone",
    recipientEncryptionKeyId: "enc_device_1",
    messageId: "msg_replay",
    eventId: "evt_replay",
    eventSeq: 1,
    throughEventSeq: 0,
    commandId: "",
    requestId: "",
    ackSeq: 0,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 60 * 60 * 1000),
  } as const;
  const envelope = await seal({
    header,
    plaintext: new TextEncoder().encode("event"),
    recipientEncryptionPublicKey: recipient.encryptionPublicKey,
    senderSigningPrivateKey: sender.signingPrivateKey,
  });
  const replayGuard = new MemoryReplayGuard();
  const request = {
    envelope,
    recipientEncryptionPrivateKey: recipient.encryptionPrivateKey,
    senderSigningPublicKey: sender.signingPublicKey,
    expectedInstallationId: header.installationId,
    expectedSenderId: header.senderId,
    expectedRecipientId: header.recipientId,
    now: new Date(createdAt.getTime() + 60_000),
    replayGuard,
  } as const;
  await open(request);

  await assert.rejects(() => open(request), (error: unknown) => {
    assert.equal(errorCodeOf(error), ProtocolErrorCode.Replay);
    return true;
  });
});

test("TypeScript seal rejects a remote command over thirty seconds", async () => {
  const createdAt = new Date("2026-07-15T03:00:00.000Z");
  await assert.rejects(
    () =>
      seal({
        header: {
          messageType: MessageType.RemoteCommand,
          installationId: "ins_command",
          senderId: "device_iphone",
          senderSigningKeyId: "sign_device_1",
          recipientId: "installation_primary",
          recipientEncryptionKeyId: "enc_installation_1",
          messageId: "msg_command",
          eventId: "",
          eventSeq: 0,
          throughEventSeq: 0,
          commandId: "cmd_01jz7example",
          requestId: "",
          ackSeq: 0,
          createdAt,
          expiresAt: new Date(createdAt.getTime() + 31_000),
        },
        plaintext: new Uint8Array(),
        recipientEncryptionPublicKey: new Uint8Array(),
        senderSigningPrivateKey: new Uint8Array(),
      }),
    (error: unknown) => {
      assert.equal(errorCodeOf(error), ProtocolErrorCode.TtlExceeded);
      return true;
    },
  );
});

test("TypeScript seal accepts an injected CSPRNG boundary", async () => {
  const sender = await generateIdentity();
  const recipient = await generateIdentity();
  const createdAt = new Date("2026-07-15T03:00:00.000Z");
  const request = {
    header: {
      messageType: MessageType.LifecycleEvent,
      installationId: "ins_deterministic",
      senderId: "installation_primary",
      senderSigningKeyId: "sign_installation_1",
      recipientId: "device_iphone",
      recipientEncryptionKeyId: "enc_device_1",
      messageId: "msg_deterministic",
      eventId: "evt_deterministic",
      eventSeq: 9,
      throughEventSeq: 0,
      commandId: "",
      requestId: "",
      ackSeq: 0,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 60 * 60 * 1000),
    },
    plaintext: new TextEncoder().encode("fixed"),
    recipientEncryptionPublicKey: recipient.encryptionPublicKey,
    senderSigningPrivateKey: sender.signingPrivateKey,
    randomSource: {
      randomBytes: (length: number) => new Uint8Array(length).fill(0x42),
    },
  } as const;

  assert.deepEqual(await seal(request), await seal(request));
});

test("TypeScript open rejects an unsupported version before crypto", async () => {
  const sender = await generateIdentity();
  const recipient = await generateIdentity();
  const createdAt = new Date("2026-07-15T03:00:00.000Z");
  const header = {
    messageType: MessageType.LifecycleEvent,
    installationId: "ins_version",
    senderId: "installation_primary",
    senderSigningKeyId: "sign_installation_1",
    recipientId: "device_iphone",
    recipientEncryptionKeyId: "enc_device_1",
    messageId: "msg_version",
    eventId: "evt_version",
    eventSeq: 3,
    throughEventSeq: 0,
    commandId: "",
    requestId: "",
    ackSeq: 0,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 60 * 60 * 1000),
  } as const;
  const envelope = await seal({
    header,
    plaintext: new TextEncoder().encode("event"),
    recipientEncryptionPublicKey: recipient.encryptionPublicKey,
    senderSigningPrivateKey: sender.signingPrivateKey,
  });
  const protectedHeader = Buffer.from(envelope.protected, "base64url")
    .toString("utf8")
    .replace('"v":1', '"v":2');
  const changedEnvelope = {
    ...envelope,
    protected: Buffer.from(protectedHeader, "utf8").toString("base64url"),
  };

  await assert.rejects(
    () =>
      open({
        envelope: changedEnvelope,
        recipientEncryptionPrivateKey: recipient.encryptionPrivateKey,
        senderSigningPublicKey: sender.signingPublicKey,
        expectedInstallationId: header.installationId,
        expectedSenderId: header.senderId,
        expectedRecipientId: header.recipientId,
        now: new Date(createdAt.getTime() + 60_000),
        replayGuard: new MemoryReplayGuard(),
      }),
    (error: unknown) => {
      assert.equal(errorCodeOf(error), ProtocolErrorCode.UnsupportedVersion);
      return true;
    },
  );
});

test("TypeScript pairing request bootstraps the device signing key", async () => {
  const device = await generateIdentity();
  const installation = await generateIdentity();
  const createdAt = new Date("2026-07-15T03:00:00.000Z");
  const header = {
    messageType: MessageType.PairingRequest,
    installationId: "ins_pairing",
    senderId: "device_candidate",
    senderSigningKeyId: "sign_device_candidate",
    recipientId: "installation_primary",
    recipientEncryptionKeyId: "enc_installation_1",
    messageId: "msg_pairing",
    eventId: "",
    eventSeq: 0,
    throughEventSeq: 0,
    commandId: "",
    requestId: "",
    ackSeq: 0,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 5 * 60_000),
  } as const;
  const envelope = await seal({
    header,
    plaintext: new TextEncoder().encode(JSON.stringify({
      pairing_id: "pair_1",
      pairing_secret: Buffer.alloc(32, 1).toString("base64url"),
      device_name: "Alice 的 iPhone",
      device_signing_public_key: Buffer.from(device.signingPublicKey).toString("base64url"),
      device_encryption_public_key: Buffer.from(device.encryptionPublicKey).toString("base64url"),
      challenge: Buffer.alloc(32, 2).toString("base64url"),
    })),
    recipientEncryptionPublicKey: installation.encryptionPublicKey,
    senderSigningPrivateKey: device.signingPrivateKey,
  });

  let pairingAccepted = false;
  const baseRequest = {
    envelope,
    recipientEncryptionPrivateKey: installation.encryptionPrivateKey,
    expectedInstallationId: header.installationId,
    expectedSenderId: header.senderId,
    expectedRecipientId: header.recipientId,
    now: new Date(createdAt.getTime() + 60_000),
    expectedPairingId: "pair_1",
    expectedPairingSecret: new Uint8Array(32).fill(9),
    pairingGuard: { acceptIfNew: async () => { pairingAccepted = true; return true; } },
  } as const;
  await assert.rejects(() => open(baseRequest), (error: unknown) => errorCodeOf(error) === ProtocolErrorCode.AuthenticationFailed);
  assert.equal(pairingAccepted, false);
  const opened = await open({ ...baseRequest, expectedPairingSecret: new Uint8Array(32).fill(1) });
  assert.deepEqual(opened.header.senderSigningPublicKey, device.signingPublicKey);
});

test("TypeScript open collapses a short signature to authentication_failed", async () => {
  const sender = await generateIdentity();
  const recipient = await generateIdentity();
  const createdAt = new Date("2026-07-15T03:00:00.000Z");
  const header = {
    messageType: MessageType.LifecycleEvent,
    installationId: "ins_short_signature",
    senderId: "installation_primary",
    senderSigningKeyId: "sign_installation_1",
    recipientId: "device_iphone",
    recipientEncryptionKeyId: "enc_device_1",
    messageId: "msg_short_signature",
    eventId: "evt_short_signature",
    eventSeq: 1,
    throughEventSeq: 0,
    commandId: "",
    requestId: "",
    ackSeq: 0,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 60 * 60_000),
  } as const;
  const envelope = await seal({
    header,
    plaintext: new TextEncoder().encode("event"),
    recipientEncryptionPublicKey: recipient.encryptionPublicKey,
    senderSigningPrivateKey: sender.signingPrivateKey,
  });

  await assert.rejects(
    () => open({
      envelope: { ...envelope, signature: Buffer.from([1]).toString("base64url") },
      recipientEncryptionPrivateKey: recipient.encryptionPrivateKey,
      senderSigningPublicKey: sender.signingPublicKey,
      expectedInstallationId: header.installationId,
      expectedSenderId: header.senderId,
      expectedRecipientId: header.recipientId,
      now: new Date(createdAt.getTime() + 60_000),
      replayGuard: new MemoryReplayGuard(),
    }),
    (error: unknown) => {
      assert.equal(errorCodeOf(error), ProtocolErrorCode.AuthenticationFailed);
      return true;
    },
  );
});

test("TypeScript rejects malformed runtime header types and negative sequences", async () => {
  const sender = await generateIdentity();
  const recipient = await generateIdentity();
  const createdAt = new Date("2026-07-15T03:00:00.000Z");
  const header = {
    messageType: MessageType.LifecycleEvent,
    installationId: "ins_runtime_types",
    senderId: "installation_primary",
    senderSigningKeyId: "sign_installation_1",
    recipientId: "device_iphone",
    recipientEncryptionKeyId: "enc_device_1",
    messageId: "msg_runtime_types",
    eventId: "evt_runtime_types",
    eventSeq: 1,
    throughEventSeq: 0,
    commandId: "",
    requestId: "",
    ackSeq: 0,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 60 * 60_000),
  } as const;
  const envelope = await seal({ header, plaintext: new Uint8Array(), recipientEncryptionPublicKey: recipient.encryptionPublicKey, senderSigningPrivateKey: sender.signingPrivateKey });
  const malformed = Buffer.from(envelope.protected, "base64url").toString("utf8").replace('"event_seq":1', '"event_seq":"1"');
  await assert.rejects(
    () => open({ envelope: { ...envelope, protected: Buffer.from(malformed).toString("base64url") }, recipientEncryptionPrivateKey: recipient.encryptionPrivateKey, senderSigningPublicKey: sender.signingPublicKey, expectedInstallationId: header.installationId, expectedSenderId: header.senderId, expectedRecipientId: header.recipientId, now: new Date(createdAt.getTime() + 60_000), replayGuard: new MemoryReplayGuard() }),
    (error: unknown) => {
      assert.equal(errorCodeOf(error), ProtocolErrorCode.InvalidEnvelope);
      return true;
    },
  );
  await assert.rejects(
    () => seal({ header: { ...header, eventSeq: -1 }, plaintext: new Uint8Array(), recipientEncryptionPublicKey: recipient.encryptionPublicKey, senderSigningPrivateKey: sender.signingPrivateKey }),
    (error: unknown) => {
      assert.equal(errorCodeOf(error), ProtocolErrorCode.InvalidHeader);
      return true;
    },
  );
});

test("TypeScript rejects an invalid message-specific identifier", async () => {
  const createdAt = new Date("2026-07-15T03:00:00.000Z");
  await assert.rejects(
    () => seal({
      header: {
        messageType: MessageType.LifecycleEvent,
        installationId: "ins_ids", senderId: "installation_primary", senderSigningKeyId: "sign_installation_1",
        recipientId: "device_iphone", recipientEncryptionKeyId: "enc_device_1", messageId: "msg_ids",
        eventId: "invalid event id", eventSeq: 1, throughEventSeq: 0, commandId: "", requestId: "", ackSeq: 0,
        createdAt, expiresAt: new Date(createdAt.getTime() + 60 * 60_000),
      },
      plaintext: new Uint8Array(), recipientEncryptionPublicKey: new Uint8Array(), senderSigningPrivateKey: new Uint8Array(),
    }),
    (error: unknown) => {
      assert.equal(errorCodeOf(error), ProtocolErrorCode.InvalidHeader);
      return true;
    },
  );
});

test("TypeScript rejects runtime field types and unrelated domain fields on seal", async () => {
  const createdAt = new Date("2026-07-15T03:00:00.000Z");
  const baseHeader = {
    messageType: MessageType.LifecycleEvent,
    installationId: "ins_runtime_seal", senderId: "installation_primary", senderSigningKeyId: "sign_installation_1",
    recipientId: "device_iphone", recipientEncryptionKeyId: "enc_device_1", messageId: "msg_runtime_seal",
    eventId: "evt_runtime_seal", eventSeq: 1, throughEventSeq: 0, commandId: "", requestId: "", ackSeq: 0,
    createdAt, expiresAt: new Date(createdAt.getTime() + 60 * 60_000),
  } as const;
  for (const header of [
    { ...baseHeader, installationId: 42 } as unknown,
    { ...baseHeader, requestId: "request_not_allowed" } as unknown,
  ]) {
    await assert.rejects(
      () => seal({ header: header as Parameters<typeof seal>[0]["header"], plaintext: new Uint8Array(), recipientEncryptionPublicKey: new Uint8Array(), senderSigningPrivateKey: new Uint8Array() }),
      (error: unknown) => {
        assert.equal(errorCodeOf(error), ProtocolErrorCode.InvalidHeader);
        return true;
      },
    );
  }
});

test("TypeScript validates pairing payloads and challenge signatures", async () => {
  const device = await generateIdentity();
  const installation = await generateIdentity();
  const secret = new Uint8Array(32).fill(1);
  const challenge = new Uint8Array(32).fill(2);
  const payload = new TextEncoder().encode(JSON.stringify({
    pairing_id: "pair_1",
    pairing_secret: Buffer.from(secret).toString("base64url"),
    device_name: "Alice 的 iPhone",
    device_signing_public_key: Buffer.from(device.signingPublicKey).toString("base64url"),
    device_encryption_public_key: Buffer.from(device.encryptionPublicKey).toString("base64url"),
    challenge: Buffer.from(challenge).toString("base64url"),
  }));
  const candidate = validatePairingCandidate(payload, device.signingPublicKey, "pair_1", secret);
  const binding = {
    pairingId: candidate.pairingId, pairingSecret: secret, challenge: candidate.challenge,
    deviceSigningPublicKey: candidate.deviceSigningPublicKey, deviceEncryptionPublicKey: candidate.deviceEncryptionPublicKey,
    installationSigningPublicKey: installation.signingPublicKey, installationEncryptionPublicKey: installation.encryptionPublicKey,
    decision: "accepted",
  } as const;
  const signature = signPairingChallenge(binding, installation.signingPrivateKey);
  verifyPairingChallenge(binding, installation.signingPublicKey, signature);
  const badPayload = new TextEncoder().encode(new TextDecoder().decode(payload).replace(Buffer.from(challenge).toString("base64url"), "AQ"));
  assert.throws(() => validatePairingCandidate(badPayload, device.signingPublicKey, "pair_1", secret), (error: unknown) => errorCodeOf(error) === ProtocolErrorCode.InvalidEnvelope);
});
