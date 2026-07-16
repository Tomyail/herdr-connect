import { Chacha20Poly1305 } from "@hpke/chacha20poly1305";
import { CipherSuite, HkdfSha256 } from "@hpke/core";
import { DhkemX25519HkdfSha256 } from "@hpke/dhkem-x25519";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base64urlnopad } from "@scure/base";

export const VERSION = 1;
export const CIPHER_SUITE =
  "HPKE-X25519-HKDF-SHA256-CHACHA20POLY1305+Ed25519";
export const MAX_PLAINTEXT_SIZE = 256 * 1024;

export enum MessageType {
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

export enum ProtocolErrorCode {
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

export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;

  constructor(code: ProtocolErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "ProtocolError";
    this.code = code;
  }
}

export function errorCodeOf(error: unknown): ProtocolErrorCode | undefined {
  return error instanceof ProtocolError ? error.code : undefined;
}

export interface Header {
  readonly version?: number;
  readonly suite?: string;
  readonly messageType: MessageType;
  readonly installationId: string;
  readonly senderId: string;
  readonly senderSigningKeyId: string;
  readonly senderSigningPublicKey?: Uint8Array;
  readonly recipientId: string;
  readonly recipientEncryptionKeyId: string;
  readonly messageId: string;
  readonly eventId: string;
  readonly eventSeq: number;
  readonly throughEventSeq: number;
  readonly commandId: string;
  readonly requestId: string;
  readonly ackSeq: number;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface Envelope {
  readonly protected: string;
  readonly ciphertext: string;
  readonly signature: string;
}

export interface Identity {
  readonly encryptionPublicKey: Uint8Array;
  readonly encryptionPrivateKey: Uint8Array;
  readonly signingPublicKey: Uint8Array;
  readonly signingPrivateKey: Uint8Array;
}

export interface SealRequest {
  readonly header: Header;
  readonly plaintext: Uint8Array;
  readonly recipientEncryptionPublicKey: Uint8Array;
  readonly senderSigningPrivateKey: Uint8Array;
  readonly randomSource?: RandomSource;
}

export interface RandomSource {
  randomBytes(length: number): Uint8Array;
}

export interface ReplayGuard {
  markIfNew(messageId: string, expiresAt: Date): Promise<boolean>;
}

export interface PairingGuard {
  acceptIfNew(messageId: string, expiresAt: Date, candidate: PairingCandidate): Promise<boolean>;
}

export interface OpenRequest {
  readonly envelope: Envelope;
  readonly recipientEncryptionPrivateKey: Uint8Array;
  readonly senderSigningPublicKey?: Uint8Array;
  readonly expectedInstallationId: string;
  readonly expectedSenderId: string;
  readonly expectedRecipientId: string;
  readonly now: Date;
  readonly replayGuard?: ReplayGuard;
  readonly expectedPairingId?: string;
  readonly expectedPairingSecret?: Uint8Array;
  readonly pairingGuard?: PairingGuard;
}

export interface OpenedMessage {
  readonly header: Header;
  readonly plaintext: Uint8Array;
  readonly pairingCandidate?: PairingCandidate;
}

export interface PairingCandidate {
  readonly pairingId: string;
  readonly deviceName: string;
  readonly deviceSigningPublicKey: Uint8Array;
  readonly deviceEncryptionPublicKey: Uint8Array;
  readonly challenge: Uint8Array;
}

export interface PairingChallengeBinding {
  readonly pairingId: string;
  readonly pairingSecret: Uint8Array;
  readonly challenge: Uint8Array;
  readonly deviceSigningPublicKey: Uint8Array;
  readonly deviceEncryptionPublicKey: Uint8Array;
  readonly installationSigningPublicKey: Uint8Array;
  readonly installationEncryptionPublicKey: Uint8Array;
  readonly decision: "accepted" | "rejected";
}

interface ProtectedHeader {
  readonly v: number;
  readonly suite: string;
  readonly message_type: MessageType;
  readonly installation_id: string;
  readonly sender_id: string;
  readonly sender_signing_key_id: string;
  readonly sender_signing_public_key: string;
  readonly recipient_id: string;
  readonly recipient_encryption_key_id: string;
  readonly message_id: string;
  readonly event_id: string;
  readonly event_seq: number;
  readonly through_event_seq: number;
  readonly command_id: string;
  readonly request_id: string;
  readonly ack_seq: number;
  readonly created_at_ms: number;
  readonly expires_at_ms: number;
  readonly enc: string;
}

const hpkeSuite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Chacha20Poly1305(),
});
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const hpkeInfo = encoder.encode("Herdr Connect Protocol v1 HPKE\0");
const signatureDomain = encoder.encode(
  "Herdr Connect Protocol v1 signature\0",
);
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const maxProtectedHeaderSize = 4096;
const maxTtlByMessageType = new Map<MessageType, number>([
  [MessageType.SessionHello, 30_000],
  [MessageType.PairingRequest, 5 * 60_000],
  [MessageType.PairingDecision, 5 * 60_000],
  [MessageType.LifecycleEvent, 24 * 60 * 60_000],
  [MessageType.StateSnapshot, 5 * 60_000],
  [MessageType.OutputRequest, 30_000],
  [MessageType.OutputSnapshot, 30_000],
  [MessageType.RemoteCommand, 30_000],
  [MessageType.CommandResult, 5 * 60_000],
  [MessageType.Ack, 5 * 60_000],
  [MessageType.Error, 5 * 60_000],
]);

export async function generateIdentity(): Promise<Identity> {
  const encryptionKeyPair = await hpkeSuite.kem.generateKeyPair();
  const encryptionPublicKey = new Uint8Array(
    await hpkeSuite.kem.serializePublicKey(encryptionKeyPair.publicKey),
  );
  const encryptionPrivateKey = new Uint8Array(
    await hpkeSuite.kem.serializePrivateKey(encryptionKeyPair.privateKey),
  );
  const signingKeyPair = ed25519.keygen();
  return {
    encryptionPublicKey,
    encryptionPrivateKey,
    signingPublicKey: new Uint8Array(signingKeyPair.publicKey),
    signingPrivateKey: new Uint8Array(signingKeyPair.secretKey),
  };
}

export function validatePairingCandidate(
  plaintext: Uint8Array,
  embeddedSigningKey: Uint8Array,
  expectedPairingId: string,
  expectedSecret: Uint8Array,
): PairingCandidate {
  if (expectedSecret.length !== 32) {
    throw new ProtocolError(ProtocolErrorCode.InvalidKey, "expected pairing secret must be 32 bytes");
  }
  let value: unknown;
  try { value = JSON.parse(decoder.decode(plaintext)) as unknown; } catch (error) {
    throw new ProtocolError(ProtocolErrorCode.InvalidEnvelope, "pairing request is not valid JSON", error);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProtocolError(ProtocolErrorCode.InvalidEnvelope, "pairing request must be an object");
  }
  const record = value as Record<string, unknown>;
  const keys = ["pairing_id", "pairing_secret", "device_name", "device_signing_public_key", "device_encryption_public_key", "challenge"];
  if (Object.keys(record).length !== keys.length || !keys.every((key) => typeof record[key] === "string")) {
    throw new ProtocolError(ProtocolErrorCode.InvalidEnvelope, "pairing request schema is invalid");
  }
  const pairingId = record.pairing_id as string;
  const deviceName = record.device_name as string;
  const secret = decodePairingField("pairing secret", record.pairing_secret as string);
  const challenge = decodePairingField("pairing challenge", record.challenge as string);
  const deviceSigningPublicKey = decodePairingField("device signing public key", record.device_signing_public_key as string);
  const deviceEncryptionPublicKey = decodePairingField("device encryption public key", record.device_encryption_public_key as string);
  if (!identifierPattern.test(pairingId) || pairingId !== expectedPairingId || !constantTimeEqual(secret, expectedSecret) || !constantTimeEqual(deviceSigningPublicKey, embeddedSigningKey)) {
    throw new ProtocolError(ProtocolErrorCode.AuthenticationFailed, "pairing credential mismatch");
  }
  if ([...deviceName].length < 1 || [...deviceName].length > 128) {
    throw new ProtocolError(ProtocolErrorCode.InvalidEnvelope, "invalid device name");
  }
  return { pairingId, deviceName, deviceSigningPublicKey, deviceEncryptionPublicKey, challenge };
}

export function pairingChallengeTranscript(binding: PairingChallengeBinding): Uint8Array {
  if (!identifierPattern.test(binding.pairingId) || !["accepted", "rejected"].includes(binding.decision)) {
    throw new ProtocolError(ProtocolErrorCode.InvalidHeader, "invalid pairing challenge identity or decision");
  }
  const fields = [encoder.encode(binding.pairingId), binding.pairingSecret, binding.challenge, binding.deviceSigningPublicKey, binding.deviceEncryptionPublicKey, binding.installationSigningPublicKey, binding.installationEncryptionPublicKey, encoder.encode(binding.decision)];
  for (const field of fields.slice(1, 7)) {
    if (field.length !== 32) throw new ProtocolError(ProtocolErrorCode.InvalidKey, "pairing challenge key material must be 32 bytes");
  }
  const parts: Uint8Array[] = [encoder.encode("Herdr Connect Protocol v1 pairing challenge\0")];
  for (const field of fields) {
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, field.length, false);
    parts.push(length, field);
  }
  return concatenate(...parts);
}

export function signPairingChallenge(binding: PairingChallengeBinding, installationSigningSeed: Uint8Array): Uint8Array {
  if (installationSigningSeed.length !== 32) throw new ProtocolError(ProtocolErrorCode.InvalidKey, "invalid Installation signing seed");
  return ed25519.sign(pairingChallengeTranscript(binding), installationSigningSeed);
}

export function verifyPairingChallenge(binding: PairingChallengeBinding, installationSigningPublicKey: Uint8Array, signature: Uint8Array): void {
  let valid = false;
  try { valid = installationSigningPublicKey.length === 32 && signature.length === 64 && ed25519.verify(signature, pairingChallengeTranscript(binding), installationSigningPublicKey); } catch { valid = false; }
  if (!valid) throw new ProtocolError(ProtocolErrorCode.AuthenticationFailed, "invalid pairing challenge signature");
}

function decodePairingField(name: string, value: string): Uint8Array {
  try {
    const decoded = base64urlnopad.decode(value);
    if (decoded.length !== 32) throw new Error("wrong length");
    return decoded;
  } catch (error) {
    throw new ProtocolError(ProtocolErrorCode.InvalidEnvelope, `${name} must be 32-byte base64url`, error);
  }
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

export async function seal(request: SealRequest): Promise<Envelope> {
  const header: Header = {
    ...request.header,
    version: request.header.version ?? VERSION,
    suite: request.header.suite ?? CIPHER_SUITE,
  };
  validateHeader(header);
  if (request.plaintext.length > MAX_PLAINTEXT_SIZE) {
    throw new ProtocolError(
      ProtocolErrorCode.MessageTooLarge,
      "plaintext exceeds protocol limit",
    );
  }
  if (request.senderSigningPrivateKey.length !== 32) {
    throw new ProtocolError(
      ProtocolErrorCode.InvalidKey,
      "invalid Ed25519 private key",
    );
  }
  const senderSigningPublicKey =
    header.messageType === MessageType.PairingRequest
      ? ed25519.getPublicKey(request.senderSigningPrivateKey)
      : header.senderSigningPublicKey;
  if (
    header.messageType !== MessageType.PairingRequest &&
    senderSigningPublicKey !== undefined &&
    senderSigningPublicKey.length !== 0
  ) {
    throw new ProtocolError(
      ProtocolErrorCode.InvalidHeader,
      "embedded signing key is only valid for pairing requests",
    );
  }
  const headerWithSigningKey: Header =
    header.messageType === MessageType.PairingRequest
      ? { ...header, senderSigningPublicKey: senderSigningPublicKey! }
      : header;
  let recipientPublicKey: CryptoKey;
  try {
    recipientPublicKey = await hpkeSuite.kem.deserializePublicKey(
      request.recipientEncryptionPublicKey,
    );
  } catch (error) {
    throw new ProtocolError(
      ProtocolErrorCode.InvalidKey,
      "invalid recipient encryption key",
      error,
    );
  }
  const senderParams: Parameters<typeof hpkeSuite.createSenderContext>[0] = {
    recipientPublicKey,
    info: hpkeInfo,
  };
  if (request.randomSource !== undefined) {
    const ephemeralKeyMaterial = request.randomSource.randomBytes(
      hpkeSuite.kem.privateKeySize,
    );
    if (ephemeralKeyMaterial.length !== hpkeSuite.kem.privateKeySize) {
      throw new Error("random source returned the wrong number of bytes");
    }
    senderParams.ekm = ephemeralKeyMaterial;
  }
  const sender = await hpkeSuite.createSenderContext(senderParams);
  const protectedHeader = headerToProtected(
    headerWithSigningKey,
    base64urlnopad.encode(new Uint8Array(sender.enc)),
  );
  const protectedBytes = encoder.encode(JSON.stringify(protectedHeader));
  if (protectedBytes.length > maxProtectedHeaderSize) {
    throw new ProtocolError(
      ProtocolErrorCode.MessageTooLarge,
      "protected header exceeds protocol limit",
    );
  }
  const ciphertext = new Uint8Array(
    await sender.seal(request.plaintext, protectedBytes),
  );
  const signature = ed25519.sign(
    signatureInput(protectedBytes, ciphertext),
    request.senderSigningPrivateKey,
  );
  return {
    protected: base64urlnopad.encode(protectedBytes),
    ciphertext: base64urlnopad.encode(ciphertext),
    signature: base64urlnopad.encode(signature),
  };
}

export async function open(request: OpenRequest): Promise<OpenedMessage> {
  const protectedBytes = decodeEnvelopeField(
    "protected header",
    request.envelope.protected,
  );
  if (protectedBytes.length > maxProtectedHeaderSize) {
    throw new ProtocolError(
      ProtocolErrorCode.MessageTooLarge,
      "protected header exceeds protocol limit",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(protectedBytes)) as unknown;
  } catch (error) {
    throw new ProtocolError(
      ProtocolErrorCode.InvalidEnvelope,
      "protected header is not valid UTF-8 JSON",
      error,
    );
  }
  let protectedHeader: ProtectedHeader;
  try {
    protectedHeader = parseProtectedHeader(parsed);
  } catch (error) {
    throw new ProtocolError(
      ProtocolErrorCode.InvalidEnvelope,
      "protected header schema is invalid",
      error,
    );
  }
  if (JSON.stringify(protectedHeader) !== decoder.decode(protectedBytes)) {
    throw new ProtocolError(
      ProtocolErrorCode.InvalidEnvelope,
      "protected header is not canonical",
    );
  }
  const header = protectedToHeader(protectedHeader);
  validateHeader(header);
  if (
    header.installationId !== request.expectedInstallationId ||
    header.senderId !== request.expectedSenderId ||
    header.recipientId !== request.expectedRecipientId
  ) {
    throw new ProtocolError(
      ProtocolErrorCode.WrongRoute,
      "envelope identity does not match expected route",
    );
  }
  const ciphertext = decodeEnvelopeField(
    "ciphertext",
    request.envelope.ciphertext,
  );
  if (ciphertext.length > MAX_PLAINTEXT_SIZE + 16) {
    throw new ProtocolError(
      ProtocolErrorCode.MessageTooLarge,
      "ciphertext exceeds protocol limit",
    );
  }
  const signature = decodeEnvelopeField("signature", request.envelope.signature);
  let senderSigningPublicKey = request.senderSigningPublicKey;
  if (header.messageType === MessageType.PairingRequest) {
    if (header.senderSigningPublicKey?.length !== 32) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidHeader,
        "pairing request has no embedded signing key",
      );
    }
    if (
      senderSigningPublicKey !== undefined &&
      !equalBytes(senderSigningPublicKey, header.senderSigningPublicKey)
    ) {
      throw new ProtocolError(
        ProtocolErrorCode.AuthenticationFailed,
        "pairing signing key mismatch",
      );
    }
    senderSigningPublicKey = header.senderSigningPublicKey;
  } else if ((header.senderSigningPublicKey?.length ?? 0) !== 0) {
    throw new ProtocolError(
      ProtocolErrorCode.InvalidHeader,
      "unexpected embedded signing key",
    );
  }
  let signatureValid = false;
  try {
    signatureValid =
      senderSigningPublicKey?.length === 32 &&
      signature.length === 64 &&
      ed25519.verify(
        signature,
        signatureInput(protectedBytes, ciphertext),
        senderSigningPublicKey,
      );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    throw new ProtocolError(
      ProtocolErrorCode.AuthenticationFailed,
      "sender authentication failed",
    );
  }
  if (request.now.getTime() < header.createdAt.getTime() - 120_000) {
    throw new ProtocolError(
      ProtocolErrorCode.CreatedInFuture,
      "message was created too far in the future",
    );
  }
  if (request.now.getTime() >= header.expiresAt.getTime()) {
    throw new ProtocolError(ProtocolErrorCode.Expired, "message expired");
  }

  let recipientPrivateKey: CryptoKey;
  try {
    recipientPrivateKey = await hpkeSuite.kem.deserializePrivateKey(
      request.recipientEncryptionPrivateKey,
    );
  } catch (error) {
    throw new ProtocolError(
      ProtocolErrorCode.InvalidKey,
      "invalid recipient encryption key",
      error,
    );
  }
  let plaintext: Uint8Array;
  try {
    const recipient = await hpkeSuite.createRecipientContext({
      recipientKey: recipientPrivateKey,
      enc: decodeEnvelopeField("encapsulated key", protectedHeader.enc),
      info: hpkeInfo,
    });
    plaintext = new Uint8Array(
      await recipient.open(ciphertext, protectedBytes),
    );
  } catch (error) {
    throw new ProtocolError(
      ProtocolErrorCode.AuthenticationFailed,
      "ciphertext authentication failed",
      error,
    );
  }
  let isNew: boolean;
  try {
    if (header.messageType === MessageType.PairingRequest) {
      if (request.pairingGuard === undefined) {
        throw new ProtocolError(ProtocolErrorCode.ReplayStoreFailed, "pairing guard is required");
      }
      const candidate = validatePairingCandidate(
        plaintext,
        header.senderSigningPublicKey!,
        request.expectedPairingId ?? "",
        request.expectedPairingSecret ?? new Uint8Array(),
      );
      isNew = await request.pairingGuard.acceptIfNew(header.messageId, header.expiresAt, candidate);
      if (isNew) return { header, plaintext, pairingCandidate: candidate };
    } else {
      if (request.replayGuard === undefined) {
        throw new ProtocolError(ProtocolErrorCode.ReplayStoreFailed, "replay guard is required");
      }
      isNew = await request.replayGuard.markIfNew(header.messageId, header.expiresAt);
    }
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError(
      ProtocolErrorCode.ReplayStoreFailed,
      "record replay state failed",
      error,
    );
  }
  if (!isNew) {
    throw new ProtocolError(ProtocolErrorCode.Replay, "message replayed");
  }
  return { header, plaintext };
}

function validateHeader(header: Header): void {
  if (
    typeof header.version !== "number" ||
    typeof header.suite !== "string" ||
    typeof header.messageType !== "string" ||
    ![
      header.installationId,
      header.senderId,
      header.senderSigningKeyId,
      header.recipientId,
      header.recipientEncryptionKeyId,
      header.messageId,
      header.eventId,
      header.commandId,
      header.requestId,
    ].every((value) => typeof value === "string") ||
    !(header.createdAt instanceof Date) ||
    !(header.expiresAt instanceof Date) ||
    (header.senderSigningPublicKey !== undefined &&
      !(header.senderSigningPublicKey instanceof Uint8Array))
  ) {
    throw new ProtocolError(
      ProtocolErrorCode.InvalidHeader,
      "header field has an invalid runtime type",
    );
  }
  if (header.version !== VERSION) {
    throw new ProtocolError(
      ProtocolErrorCode.UnsupportedVersion,
      `unsupported protocol version ${String(header.version)}`,
    );
  }
  if (header.suite !== CIPHER_SUITE) {
    throw new ProtocolError(
      ProtocolErrorCode.UnsupportedSuite,
      `unsupported cipher suite ${String(header.suite)}`,
    );
  }
  const maxTtl = maxTtlByMessageType.get(header.messageType);
  if (maxTtl === undefined) {
    throw new ProtocolError(
      ProtocolErrorCode.UnsupportedMessageType,
      `unsupported message type ${header.messageType}`,
    );
  }
  if (
    !header.installationId ||
    !header.senderId ||
    !header.senderSigningKeyId ||
    !header.recipientId ||
    !header.recipientEncryptionKeyId ||
    !header.messageId
  ) {
    throw new ProtocolError(
      ProtocolErrorCode.InvalidHeader,
      "required header identity is missing",
    );
  }
  for (const identifier of [
    header.installationId,
    header.senderId,
    header.senderSigningKeyId,
    header.recipientId,
    header.recipientEncryptionKeyId,
    header.messageId,
  ]) {
    if (!identifierPattern.test(identifier)) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidHeader,
        `invalid identifier ${identifier}`,
      );
    }
  }
  if (
    !isNonnegativeSafeInteger(header.eventSeq) ||
    !isNonnegativeSafeInteger(header.throughEventSeq) ||
    !isNonnegativeSafeInteger(header.ackSeq)
  ) {
    throw new ProtocolError(
      ProtocolErrorCode.InvalidHeader,
      "sequence exceeds interoperable integer range",
    );
  }
  for (const identifier of [header.eventId, header.commandId, header.requestId]) {
    if (identifier !== "" && !identifierPattern.test(identifier)) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidHeader,
        `invalid message-specific identifier ${identifier}`,
      );
    }
  }
  switch (header.messageType) {
    case MessageType.LifecycleEvent:
      if (!identifierPattern.test(header.eventId) || header.eventSeq <= 0) {
        throw new ProtocolError(
          ProtocolErrorCode.InvalidHeader,
          "lifecycle event identity is missing",
        );
      }
      if (
        header.throughEventSeq !== 0 || header.commandId !== "" ||
        header.requestId !== "" || header.ackSeq !== 0
      ) {
        throw new ProtocolError(ProtocolErrorCode.InvalidHeader, "lifecycle event has unrelated fields");
      }
      break;
    case MessageType.StateSnapshot:
      if (
        header.eventId !== "" || header.eventSeq !== 0 ||
        header.commandId !== "" || header.requestId !== "" || header.ackSeq !== 0
      ) {
        throw new ProtocolError(ProtocolErrorCode.InvalidHeader, "state snapshot has unrelated fields");
      }
      break;
    case MessageType.RemoteCommand:
    case MessageType.CommandResult:
      if (!identifierPattern.test(header.commandId)) {
        throw new ProtocolError(
          ProtocolErrorCode.InvalidHeader,
          "remote command identity is missing",
        );
      }
      if (
        header.eventId !== "" || header.eventSeq !== 0 ||
        header.throughEventSeq !== 0 || header.requestId !== "" || header.ackSeq !== 0
      ) {
        throw new ProtocolError(ProtocolErrorCode.InvalidHeader, "command message has unrelated fields");
      }
      break;
    case MessageType.OutputRequest:
    case MessageType.OutputSnapshot:
      if (!identifierPattern.test(header.requestId)) {
        throw new ProtocolError(
          ProtocolErrorCode.InvalidHeader,
          "output request identity is missing",
        );
      }
      if (
        header.eventId !== "" || header.eventSeq !== 0 ||
        header.throughEventSeq !== 0 || header.commandId !== "" || header.ackSeq !== 0
      ) {
        throw new ProtocolError(ProtocolErrorCode.InvalidHeader, "output message has unrelated fields");
      }
      break;
    case MessageType.Ack:
      if (header.ackSeq <= 0) {
        throw new ProtocolError(
          ProtocolErrorCode.InvalidHeader,
          "ack cursor is missing",
        );
      }
      if (
        header.eventId !== "" || header.eventSeq !== 0 ||
        header.throughEventSeq !== 0 || header.commandId !== "" || header.requestId !== ""
      ) {
        throw new ProtocolError(ProtocolErrorCode.InvalidHeader, "ack has unrelated fields");
      }
      break;
    default:
      if (
        header.eventId !== "" || header.eventSeq !== 0 ||
        header.throughEventSeq !== 0 || header.commandId !== "" ||
        header.requestId !== "" || header.ackSeq !== 0
      ) {
        throw new ProtocolError(ProtocolErrorCode.InvalidHeader, "message has unrelated fields");
      }
      break;
  }
  const createdAt = header.createdAt.getTime();
  const expiresAt = header.expiresAt.getTime();
  if (
    !isNonnegativeSafeInteger(createdAt) ||
    !isNonnegativeSafeInteger(expiresAt)
  ) {
    throw new ProtocolError(
      ProtocolErrorCode.InvalidHeader,
      "timestamp exceeds interoperable integer range",
    );
  }
  const lifetime = expiresAt - createdAt;
  if (lifetime <= 0) {
    throw new ProtocolError(
      ProtocolErrorCode.InvalidHeader,
      "invalid message lifetime",
    );
  }
  if (lifetime > maxTtl) {
    throw new ProtocolError(
      ProtocolErrorCode.TtlExceeded,
      "message lifetime exceeds limit",
    );
  }
}

function headerToProtected(header: Header, enc: string): ProtectedHeader {
  return {
    v: header.version ?? VERSION,
    suite: header.suite ?? CIPHER_SUITE,
    message_type: header.messageType,
    installation_id: header.installationId,
    sender_id: header.senderId,
    sender_signing_key_id: header.senderSigningKeyId,
    sender_signing_public_key: base64urlnopad.encode(
      header.senderSigningPublicKey ?? new Uint8Array(),
    ),
    recipient_id: header.recipientId,
    recipient_encryption_key_id: header.recipientEncryptionKeyId,
    message_id: header.messageId,
    event_id: header.eventId,
    event_seq: header.eventSeq,
    through_event_seq: header.throughEventSeq,
    command_id: header.commandId,
    request_id: header.requestId,
    ack_seq: header.ackSeq,
    created_at_ms: header.createdAt.getTime(),
    expires_at_ms: header.expiresAt.getTime(),
    enc,
  };
}

function protectedToHeader(header: ProtectedHeader): Header {
  return {
    version: header.v,
    suite: header.suite,
    messageType: header.message_type,
    installationId: header.installation_id,
    senderId: header.sender_id,
    senderSigningKeyId: header.sender_signing_key_id,
    senderSigningPublicKey: decodeEnvelopeField(
      "sender signing public key",
      header.sender_signing_public_key,
    ),
    recipientId: header.recipient_id,
    recipientEncryptionKeyId: header.recipient_encryption_key_id,
    messageId: header.message_id,
    eventId: header.event_id,
    eventSeq: header.event_seq,
    throughEventSeq: header.through_event_seq,
    commandId: header.command_id,
    requestId: header.request_id,
    ackSeq: header.ack_seq,
    createdAt: new Date(header.created_at_ms),
    expiresAt: new Date(header.expires_at_ms),
  };
}

function parseProtectedHeader(value: unknown): ProtectedHeader {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("protected header must be an object");
  }
  const expectedKeys = [
    "v",
    "suite",
    "message_type",
    "installation_id",
    "sender_id",
    "sender_signing_key_id",
    "sender_signing_public_key",
    "recipient_id",
    "recipient_encryption_key_id",
    "message_id",
    "event_id",
    "event_seq",
    "through_event_seq",
    "command_id",
    "request_id",
    "ack_seq",
    "created_at_ms",
    "expires_at_ms",
    "enc",
  ];
  if (
    Object.keys(value).length !== expectedKeys.length ||
    !expectedKeys.every((key) => Object.hasOwn(value, key))
  ) {
    throw new Error("protected header has unknown or missing fields");
  }
  const record = value as Record<string, unknown>;
  const stringFields = [
    "suite", "message_type", "installation_id", "sender_id",
    "sender_signing_key_id", "sender_signing_public_key", "recipient_id",
    "recipient_encryption_key_id", "message_id", "event_id", "command_id",
    "request_id", "enc",
  ];
  const integerFields = [
    "v", "event_seq", "through_event_seq", "ack_seq", "created_at_ms",
    "expires_at_ms",
  ];
  if (
    !stringFields.every((key) => typeof record[key] === "string") ||
    !integerFields.every((key) => isNonnegativeSafeInteger(record[key]))
  ) {
    throw new Error("protected header field has an invalid runtime type");
  }
  return record as unknown as ProtectedHeader;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function signatureInput(
  protectedBytes: Uint8Array,
  ciphertext: Uint8Array,
): Uint8Array {
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, protectedBytes.length, false);
  return concatenate(signatureDomain, length, protectedBytes, ciphertext);
}

function concatenate(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function decodeEnvelopeField(field: string, value: string): Uint8Array {
  try {
    return base64urlnopad.decode(value);
  } catch (error) {
    throw new ProtocolError(
      ProtocolErrorCode.InvalidEnvelope,
      `invalid base64url in ${field}`,
      error,
    );
  }
}
