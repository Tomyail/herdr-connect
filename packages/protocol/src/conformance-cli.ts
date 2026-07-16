import { base64urlnopad } from "@scure/base";

import {
  errorCodeOf,
  generateIdentity,
  MessageType,
  open,
  seal,
  signPairingChallenge,
  verifyPairingChallenge,
  type Header,
} from "./index.js";

interface ConformanceHeader {
  readonly message_type: MessageType;
  readonly installation_id: string;
  readonly sender_id: string;
  readonly sender_signing_key_id: string;
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
}

interface ConformanceRequest {
  readonly operation: string;
  readonly header?: ConformanceHeader;
  readonly plaintext?: string;
  readonly envelope?: {
    readonly protected: string;
    readonly ciphertext: string;
    readonly signature: string;
  };
  readonly recipient_encryption_public_key?: string;
  readonly recipient_encryption_private_key?: string;
  readonly sender_signing_private_key?: string;
  readonly sender_signing_public_key?: string;
  readonly expected_installation_id?: string;
  readonly expected_sender_id?: string;
  readonly expected_recipient_id?: string;
  readonly expected_pairing_id?: string;
  readonly expected_pairing_secret?: string;
  readonly now_ms?: number;
  readonly ephemeral_key_material?: string;
  readonly pairing_binding?: ConformancePairingBinding;
  readonly installation_signing_private_key?: string;
  readonly installation_signing_public_key?: string;
  readonly pairing_challenge_signature?: string;
}

interface ConformancePairingBinding {
  readonly pairing_id: string;
  readonly pairing_secret: string;
  readonly challenge: string;
  readonly device_signing_public_key: string;
  readonly device_encryption_public_key: string;
  readonly installation_signing_public_key: string;
  readonly installation_encryption_public_key: string;
  readonly decision: "accepted" | "rejected";
}

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) {
  chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
}
const input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ConformanceRequest;

try {
  switch (input.operation) {
    case "generate_identity": {
      const identity = await generateIdentity();
      write({
        identity: {
          encryption_public_key: base64urlnopad.encode(
            identity.encryptionPublicKey,
          ),
          encryption_private_key: base64urlnopad.encode(
            identity.encryptionPrivateKey,
          ),
          signing_public_key: base64urlnopad.encode(identity.signingPublicKey),
          signing_private_key: base64urlnopad.encode(
            identity.signingPrivateKey,
          ),
        },
      });
      break;
    }
    case "seal": {
      const header = requireValue(input.header, "header");
      const ephemeralKeyMaterial = input.ephemeral_key_material;
      const envelope = await seal({
        header: fromConformanceHeader(header),
        plaintext: base64urlnopad.decode(
          requireValue(input.plaintext, "plaintext"),
        ),
        recipientEncryptionPublicKey: base64urlnopad.decode(
          requireValue(
            input.recipient_encryption_public_key,
            "recipient_encryption_public_key",
          ),
        ),
        senderSigningPrivateKey: base64urlnopad.decode(
          requireValue(
            input.sender_signing_private_key,
            "sender_signing_private_key",
          ),
        ),
        ...(ephemeralKeyMaterial === undefined
          ? {}
          : {
              randomSource: {
                randomBytes: (length: number) => {
                  const bytes = base64urlnopad.decode(ephemeralKeyMaterial);
                  if (bytes.length !== length) {
                    throw new Error(
                      "ephemeral_key_material has the wrong length",
                    );
                  }
                  return bytes;
                },
              },
            }),
      });
      write({ envelope });
      break;
    }
    case "sign_pairing_challenge": {
      const signature = signPairingChallenge(
        fromConformancePairingBinding(requireValue(input.pairing_binding, "pairing_binding")),
        base64urlnopad.decode(requireValue(input.installation_signing_private_key, "installation_signing_private_key")),
      );
      write({ signature: base64urlnopad.encode(signature) });
      break;
    }
    case "verify_pairing_challenge": {
      verifyPairingChallenge(
        fromConformancePairingBinding(requireValue(input.pairing_binding, "pairing_binding")),
        base64urlnopad.decode(requireValue(input.installation_signing_public_key, "installation_signing_public_key")),
        base64urlnopad.decode(requireValue(input.pairing_challenge_signature, "pairing_challenge_signature")),
      );
      write({ valid: true });
      break;
    }
    case "open":
    case "open_replay": {
      const senderSigningPublicKey = input.sender_signing_public_key;
      const seen = new Set<string>();
      let pairingAccepted = false;
      const openRequest = {
        envelope: requireValue(input.envelope, "envelope"),
        recipientEncryptionPrivateKey: base64urlnopad.decode(
          requireValue(
            input.recipient_encryption_private_key,
            "recipient_encryption_private_key",
          ),
        ),
        ...(senderSigningPublicKey === undefined
          ? {}
          : {
              senderSigningPublicKey: base64urlnopad.decode(
                senderSigningPublicKey,
              ),
            }),
        expectedInstallationId: requireValue(
          input.expected_installation_id,
          "expected_installation_id",
        ),
        expectedSenderId: requireValue(
          input.expected_sender_id,
          "expected_sender_id",
        ),
        expectedRecipientId: requireValue(
          input.expected_recipient_id,
          "expected_recipient_id",
        ),
        now: new Date(requireValue(input.now_ms, "now_ms")),
        replayGuard: {
          markIfNew: async (messageId: string) => {
            if (input.operation !== "open_replay") return true;
            if (seen.has(messageId)) return false;
            seen.add(messageId);
            return true;
          },
        },
        ...(input.expected_pairing_id === undefined ||
        input.expected_pairing_secret === undefined
          ? {}
          : {
              expectedPairingId: input.expected_pairing_id,
              expectedPairingSecret: base64urlnopad.decode(
                input.expected_pairing_secret,
              ),
            }),
        pairingGuard: {
          acceptIfNew: async () => {
            if (pairingAccepted) return false;
            pairingAccepted = true;
            return true;
          },
        },
      } as const;
      const opened = await open(openRequest);
      if (input.operation === "open_replay") {
        try {
          await open(openRequest);
          throw new Error("replay unexpectedly accepted");
        } catch (error) {
          write({ error_code: errorCodeOf(error) });
          break;
        }
      }
      write({
        header: toConformanceHeader(opened.header),
        plaintext: base64urlnopad.encode(opened.plaintext),
      });
      break;
    }
    default:
      throw new Error(`unknown operation ${input.operation}`);
  }
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ error_code: errorCodeOf(error), message: error instanceof Error ? error.message : String(error) })}\n`,
  );
  process.exitCode = 1;
}

function fromConformanceHeader(header: ConformanceHeader): Header {
  return {
    messageType: header.message_type,
    installationId: header.installation_id,
    senderId: header.sender_id,
    senderSigningKeyId: header.sender_signing_key_id,
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

function fromConformancePairingBinding(binding: ConformancePairingBinding) {
  return {
    pairingId: binding.pairing_id,
    pairingSecret: base64urlnopad.decode(binding.pairing_secret),
    challenge: base64urlnopad.decode(binding.challenge),
    deviceSigningPublicKey: base64urlnopad.decode(binding.device_signing_public_key),
    deviceEncryptionPublicKey: base64urlnopad.decode(binding.device_encryption_public_key),
    installationSigningPublicKey: base64urlnopad.decode(binding.installation_signing_public_key),
    installationEncryptionPublicKey: base64urlnopad.decode(binding.installation_encryption_public_key),
    decision: binding.decision,
  };
}

function toConformanceHeader(header: Header): ConformanceHeader {
  return {
    message_type: header.messageType,
    installation_id: header.installationId,
    sender_id: header.senderId,
    sender_signing_key_id: header.senderSigningKeyId,
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
  };
}

function requireValue<T>(value: T | undefined, field: string): T {
  if (value === undefined) {
    throw new Error(`${field} is required`);
  }
  return value;
}

function write(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
