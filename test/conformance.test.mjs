import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
const temp = mkdtempSync(join(tmpdir(), "herdr-connect-conformance-"));
const goCli = join(temp, "protocol-conformance-go");
const tsCli = join(root, "packages/protocol/dist/src/conformance-cli.js");

execFileSync("go", ["build", "-o", goCli, "./cmd/protocol-conformance"], {
  cwd: root,
  env: {
    ...process.env,
    GOCACHE: join(temp, "go-build"),
    GOMODCACHE:
      process.env.GOMODCACHE ?? "/tmp/herdr-connect-go-mod-cache",
  },
  stdio: "pipe",
});

function call(command, args, request) {
  const output = execFileSync(command, args, {
    cwd: root,
    input: JSON.stringify(request),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return JSON.parse(output);
}

function callGo(request) {
  return call(goCli, [], request);
}

function callTypeScript(request) {
  return call(process.execPath, [tsCli], request);
}

function callFailure(command, args, request) {
  try {
    call(command, args, request);
    assert.fail("command unexpectedly succeeded");
  } catch (error) {
    assert.equal(error.status, 1);
    return JSON.parse(error.stderr.trim());
  }
}

const header = {
  message_type: "lifecycle_event",
  installation_id: "ins_conformance",
  sender_id: "installation_primary",
  sender_signing_key_id: "sign_sender_1",
  recipient_id: "device_recipient",
  recipient_encryption_key_id: "enc_recipient_1",
  message_id: "msg_conformance",
  event_id: "evt_conformance",
  event_seq: 7,
  through_event_seq: 0,
  command_id: "",
  request_id: "",
  ack_seq: 0,
  created_at_ms: Date.parse("2026-07-15T03:00:00.000Z"),
  expires_at_ms: Date.parse("2026-07-15T04:00:00.000Z"),
};
const nowMs = Date.parse("2026-07-15T03:01:00.000Z");
const plaintext = Buffer.from("Go 与 TypeScript 互操作", "utf8").toString(
  "base64url",
);

test("Go seals and TypeScript opens the same Protocol v1 envelope", () => {
  const sender = callGo({ operation: "generate_identity" }).identity;
  const recipient = callTypeScript({ operation: "generate_identity" }).identity;
  const sealed = callGo({
    operation: "seal",
    header,
    plaintext,
    recipient_encryption_public_key: recipient.encryption_public_key,
    sender_signing_private_key: sender.signing_private_key,
  });
  const opened = callTypeScript({
    operation: "open",
    envelope: sealed.envelope,
    recipient_encryption_private_key: recipient.encryption_private_key,
    sender_signing_public_key: sender.signing_public_key,
    expected_installation_id: header.installation_id,
    expected_sender_id: header.sender_id,
    expected_recipient_id: header.recipient_id,
    now_ms: nowMs,
  });
  assert.equal(opened.plaintext, plaintext);
  assert.equal(opened.header.event_id, header.event_id);
});

test("TypeScript seals and Go opens the same Protocol v1 envelope", () => {
  const sender = callTypeScript({ operation: "generate_identity" }).identity;
  const recipient = callGo({ operation: "generate_identity" }).identity;
  const sealed = callTypeScript({
    operation: "seal",
    header,
    plaintext,
    recipient_encryption_public_key: recipient.encryption_public_key,
    sender_signing_private_key: sender.signing_private_key,
  });
  const opened = callGo({
    operation: "open",
    envelope: sealed.envelope,
    recipient_encryption_private_key: recipient.encryption_private_key,
    sender_signing_public_key: sender.signing_public_key,
    expected_installation_id: header.installation_id,
    expected_sender_id: header.sender_id,
    expected_recipient_id: header.recipient_id,
    now_ms: nowMs,
  });
  assert.equal(opened.plaintext, plaintext);
  assert.equal(opened.header.event_id, header.event_id);
});

test("both CLIs collapse ciphertext tampering to authentication_failed", () => {
  const sender = callGo({ operation: "generate_identity" }).identity;
  const recipient = callTypeScript({ operation: "generate_identity" }).identity;
  const sealed = callGo({
    operation: "seal",
    header,
    plaintext,
    recipient_encryption_public_key: recipient.encryption_public_key,
    sender_signing_private_key: sender.signing_private_key,
  });
  const first = sealed.envelope.ciphertext[0] === "A" ? "B" : "A";
  const envelope = {
    ...sealed.envelope,
    ciphertext: first + sealed.envelope.ciphertext.slice(1),
  };
  const request = {
    operation: "open",
    envelope,
    recipient_encryption_private_key: recipient.encryption_private_key,
    sender_signing_public_key: sender.signing_public_key,
    expected_installation_id: header.installation_id,
    expected_sender_id: header.sender_id,
    expected_recipient_id: header.recipient_id,
    now_ms: nowMs,
  };

  const goFailure = callFailure(goCli, [], request);
  const tsFailure = callFailure(process.execPath, [tsCli], request);
  assert.equal(goFailure.error_code, "authentication_failed");
  assert.equal(tsFailure.error_code, "authentication_failed");
});

test("both CLIs reproduce the fixed Protocol v1 vector byte for byte", () => {
  const vector = JSON.parse(
    readFileSync(join(root, "protocol/testdata/v1/envelope.json"), "utf8"),
  );
  const request = {
    operation: "seal",
    header: vector.header,
    plaintext: vector.plaintext,
    recipient_encryption_public_key:
      vector.keys.recipient_encryption_public_key,
    sender_signing_private_key: vector.keys.sender_signing_private_key,
    ephemeral_key_material: vector.ephemeral_key_material,
  };

  assert.deepEqual(callGo(request).envelope, vector.envelope);
  assert.deepEqual(callTypeScript(request).envelope, vector.envelope);
});

test("both CLIs reject a message at expires_at", () => {
  const sender = callGo({ operation: "generate_identity" }).identity;
  const recipient = callTypeScript({ operation: "generate_identity" }).identity;
  const sealed = callGo({
    operation: "seal",
    header,
    plaintext,
    recipient_encryption_public_key: recipient.encryption_public_key,
    sender_signing_private_key: sender.signing_private_key,
  });
  const request = {
    operation: "open",
    envelope: sealed.envelope,
    recipient_encryption_private_key: recipient.encryption_private_key,
    sender_signing_public_key: sender.signing_public_key,
    expected_installation_id: header.installation_id,
    expected_sender_id: header.sender_id,
    expected_recipient_id: header.recipient_id,
    now_ms: header.expires_at_ms,
  };

  assert.equal(callFailure(goCli, [], request).error_code, "expired");
  assert.equal(
    callFailure(process.execPath, [tsCli], request).error_code,
    "expired",
  );
});

test("pairing requests bootstrap an untrusted device key in both directions", () => {
  const pairingSecret = Buffer.alloc(32, 1).toString("base64url");
  const challenge = Buffer.alloc(32, 2).toString("base64url");
  const pairingHeader = {
    ...header,
    message_type: "pairing_request",
    sender_id: "device_candidate",
    sender_signing_key_id: "sign_device_candidate",
    recipient_id: "installation_primary",
    recipient_encryption_key_id: "enc_installation_1",
    message_id: "msg_pairing_conformance",
    event_id: "",
    event_seq: 0,
    expires_at_ms: header.created_at_ms + 5 * 60_000,
  };
  for (const [sealWith, openWith] of [
    [callGo, callTypeScript],
    [callTypeScript, callGo],
  ]) {
    const device = sealWith({ operation: "generate_identity" }).identity;
    const installation = openWith({ operation: "generate_identity" }).identity;
    const sealed = sealWith({
      operation: "seal",
      header: pairingHeader,
      plaintext: Buffer.from(JSON.stringify({
        pairing_id: "pair_1",
        pairing_secret: pairingSecret,
        device_name: "Alice 的 iPhone",
        device_signing_public_key: device.signing_public_key,
        device_encryption_public_key: device.encryption_public_key,
        challenge,
      })).toString("base64url"),
      recipient_encryption_public_key: installation.encryption_public_key,
      sender_signing_private_key: device.signing_private_key,
    });
    const opened = openWith({
      operation: "open",
      envelope: sealed.envelope,
      recipient_encryption_private_key: installation.encryption_private_key,
      expected_installation_id: pairingHeader.installation_id,
      expected_sender_id: pairingHeader.sender_id,
      expected_recipient_id: pairingHeader.recipient_id,
      now_ms: nowMs,
      expected_pairing_id: "pair_1",
      expected_pairing_secret: pairingSecret,
    });
    assert.equal(opened.plaintext.length > 0, true);
  }
});

test("both CLIs reject the complete tampering and wrong-device matrix", () => {
  const sender = callGo({ operation: "generate_identity" }).identity;
  const recipient = callTypeScript({ operation: "generate_identity" }).identity;
  const wrongRecipient = callGo({ operation: "generate_identity" }).identity;
  const sealed = callGo({
    operation: "seal",
    header,
    plaintext,
    recipient_encryption_public_key: recipient.encryption_public_key,
    sender_signing_private_key: sender.signing_private_key,
  });
  const mutateFirst = (value) => (value[0] === "A" ? "B" : "A") + value.slice(1);
  const mutateProtected = (change) => {
    const protectedHeader = JSON.parse(
      Buffer.from(sealed.envelope.protected, "base64url").toString("utf8"),
    );
    change(protectedHeader);
    return Buffer.from(JSON.stringify(protectedHeader)).toString("base64url");
  };
  const cases = [
    {
      name: "protected header",
      envelope: { ...sealed.envelope, protected: mutateProtected((value) => { value.event_id = "evt_tampered"; }) },
    },
    {
      name: "ciphertext",
      envelope: { ...sealed.envelope, ciphertext: mutateFirst(sealed.envelope.ciphertext) },
    },
    {
      name: "signature",
      envelope: { ...sealed.envelope, signature: mutateFirst(sealed.envelope.signature) },
    },
    {
      name: "HPKE enc/nonce context",
      envelope: { ...sealed.envelope, protected: mutateProtected((value) => { value.enc = mutateFirst(value.enc); }) },
    },
    {
      name: "recipient",
      envelope: { ...sealed.envelope, protected: mutateProtected((value) => { value.recipient_id = "device_attacker"; }) },
      expectedRecipientId: "device_attacker",
    },
    {
      name: "wrong device key",
      envelope: sealed.envelope,
      recipientPrivateKey: wrongRecipient.encryption_private_key,
    },
  ];
  for (const testCase of cases) {
    const request = {
      operation: "open",
      envelope: testCase.envelope,
      recipient_encryption_private_key:
        testCase.recipientPrivateKey ?? recipient.encryption_private_key,
      sender_signing_public_key: sender.signing_public_key,
      expected_installation_id: header.installation_id,
      expected_sender_id: header.sender_id,
      expected_recipient_id: testCase.expectedRecipientId ?? header.recipient_id,
      now_ms: nowMs,
    };
    assert.equal(callFailure(goCli, [], request).error_code, "authentication_failed", `Go: ${testCase.name}`);
    assert.equal(callFailure(process.execPath, [tsCli], request).error_code, "authentication_failed", `TypeScript: ${testCase.name}`);
  }
});

test("one logical event has stable identity and distinct per-device ciphertext", () => {
  const sender = callGo({ operation: "generate_identity" }).identity;
  const firstRecipient = callGo({ operation: "generate_identity" }).identity;
  const secondRecipient = callTypeScript({ operation: "generate_identity" }).identity;
  const firstHeader = { ...header, recipient_id: "device_first", recipient_encryption_key_id: "enc_first", message_id: "msg_first" };
  const secondHeader = { ...header, recipient_id: "device_second", recipient_encryption_key_id: "enc_second", message_id: "msg_second" };
  const first = callGo({ operation: "seal", header: firstHeader, plaintext, recipient_encryption_public_key: firstRecipient.encryption_public_key, sender_signing_private_key: sender.signing_private_key });
  const second = callTypeScript({ operation: "seal", header: secondHeader, plaintext, recipient_encryption_public_key: secondRecipient.encryption_public_key, sender_signing_private_key: sender.signing_private_key });

  assert.equal(firstHeader.event_id, secondHeader.event_id);
  assert.equal(firstHeader.event_seq, secondHeader.event_seq);
  assert.notEqual(first.envelope.ciphertext, second.envelope.ciphertext);
  const firstOpened = callTypeScript({ operation: "open", envelope: first.envelope, recipient_encryption_private_key: firstRecipient.encryption_private_key, sender_signing_public_key: sender.signing_public_key, expected_installation_id: firstHeader.installation_id, expected_sender_id: firstHeader.sender_id, expected_recipient_id: firstHeader.recipient_id, now_ms: nowMs });
  const secondOpened = callGo({ operation: "open", envelope: second.envelope, recipient_encryption_private_key: secondRecipient.encryption_private_key, sender_signing_public_key: sender.signing_public_key, expected_installation_id: secondHeader.installation_id, expected_sender_id: secondHeader.sender_id, expected_recipient_id: secondHeader.recipient_id, now_ms: nowMs });
  assert.equal(firstOpened.header.event_id, secondOpened.header.event_id);
  assert.equal(firstOpened.header.event_seq, secondOpened.header.event_seq);
});

test("both CLIs expose stable replay, version, and message-type behavior", () => {
  const sender = callGo({ operation: "generate_identity" }).identity;
  const recipient = callTypeScript({ operation: "generate_identity" }).identity;
  const sealed = callGo({ operation: "seal", header, plaintext, recipient_encryption_public_key: recipient.encryption_public_key, sender_signing_private_key: sender.signing_private_key });
  const baseRequest = { envelope: sealed.envelope, recipient_encryption_private_key: recipient.encryption_private_key, sender_signing_public_key: sender.signing_public_key, expected_installation_id: header.installation_id, expected_sender_id: header.sender_id, expected_recipient_id: header.recipient_id, now_ms: nowMs };
  assert.equal(callGo({ operation: "open_replay", ...baseRequest }).error_code, "replay");
  assert.equal(callTypeScript({ operation: "open_replay", ...baseRequest }).error_code, "replay");
  const mutate = (field, value) => {
    const protectedHeader = JSON.parse(Buffer.from(sealed.envelope.protected, "base64url").toString("utf8"));
    protectedHeader[field] = value;
    return { ...sealed.envelope, protected: Buffer.from(JSON.stringify(protectedHeader)).toString("base64url") };
  };
  for (const [field, value, code] of [["v", 2, "unsupported_version"], ["message_type", "future_message", "unsupported_message_type"]]) {
    const request = { operation: "open", ...baseRequest, envelope: mutate(field, value) };
    assert.equal(callFailure(goCli, [], request).error_code, code);
    assert.equal(callFailure(process.execPath, [tsCli], request).error_code, code);
  }
});

test("pairing challenge signatures verify across Go and TypeScript", () => {
  const installation = callGo({ operation: "generate_identity" }).identity;
  const device = callTypeScript({ operation: "generate_identity" }).identity;
  const pairingBinding = {
    pairing_id: "pair_cross_signature",
    pairing_secret: Buffer.alloc(32, 1).toString("base64url"),
    challenge: Buffer.alloc(32, 2).toString("base64url"),
    device_signing_public_key: device.signing_public_key,
    device_encryption_public_key: device.encryption_public_key,
    installation_signing_public_key: installation.signing_public_key,
    installation_encryption_public_key: installation.encryption_public_key,
    decision: "accepted",
  };
  const goSignature = callGo({ operation: "sign_pairing_challenge", pairing_binding: pairingBinding, installation_signing_private_key: installation.signing_private_key }).signature;
  assert.equal(callTypeScript({ operation: "verify_pairing_challenge", pairing_binding: pairingBinding, installation_signing_public_key: installation.signing_public_key, pairing_challenge_signature: goSignature }).valid, true);
  const tsSignature = callTypeScript({ operation: "sign_pairing_challenge", pairing_binding: pairingBinding, installation_signing_private_key: installation.signing_private_key }).signature;
  assert.equal(callGo({ operation: "verify_pairing_challenge", pairing_binding: pairingBinding, installation_signing_public_key: installation.signing_public_key, pairing_challenge_signature: tsSignature }).valid, true);
  assert.equal(goSignature, tsSignature);
});
