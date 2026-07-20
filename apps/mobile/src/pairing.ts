/**
 * QR pairing payload parsing and URL construction.
 *
 * The daemon's `herdr-connect pair` CLI renders a QR code containing a JSON
 * payload with the certificate fingerprint, reachable hosts, port, and a
 * one-time pairing secret. This module parses and validates that payload,
 * then builds the POST URL for the `/v1/pair` endpoint.
 *
 * This module is pure parsing + URL building — it does NOT issue network
 * requests. The actual pairing request lives in network.ts (pairDaemon).
 *
 * Trust model: the QR fingerprint is trusted because physical proximity to
 * the terminal screen constitutes out-of-band confirmation. See
 * docs/security/lan-tls-pairing.md.
 */

import { NetworkError } from "./i18n/errors";
import { preferredAddress } from "./address";

/** Shape deserialized from the QR code JSON. */
export interface PairingQRPayload {
  /** Protocol version (currently 1). */
  readonly v: number;
  /** base64url SHA-256 of the daemon's leaf certificate DER (no padding). */
  readonly fp: string;
  /** Reachable LAN addresses (IPv4 first, then IPv6). */
  readonly hosts: readonly string[];
  /** HTTPS port (always 9808). */
  readonly port: number;
  /** One-time pairing secret. */
  readonly secret: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse and validate a raw QR payload string.
 *
 * Throws {@link NetworkError} with code `"pairing_qr_invalid"` for any
 * structural or semantic problem — missing fields, wrong types, empty
 * strings, empty arrays. The unified code avoids leaking which specific
 * field was invalid to an attacker who might craft QR payloads.
 */
export function parsePairingQRPayload(raw: string): PairingQRPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new NetworkError("pairing_qr_invalid");
  }

  if (!isRecord(parsed)) {
    throw new NetworkError("pairing_qr_invalid");
  }

  if (typeof parsed.v !== "number") {
    throw new NetworkError("pairing_qr_invalid");
  }
  if (typeof parsed.fp !== "string" || parsed.fp.length === 0) {
    throw new NetworkError("pairing_qr_invalid");
  }
  if (typeof parsed.secret !== "string" || parsed.secret.length === 0) {
    throw new NetworkError("pairing_qr_invalid");
  }
  if (
    !Array.isArray(parsed.hosts) ||
    parsed.hosts.length === 0 ||
    parsed.hosts.some((h) => typeof h !== "string")
  ) {
    throw new NetworkError("pairing_qr_invalid");
  }
  if (typeof parsed.port !== "number" || !Number.isInteger(parsed.port) || parsed.port <= 0) {
    throw new NetworkError("pairing_qr_invalid");
  }

  return {
    v: parsed.v,
    fp: parsed.fp,
    hosts: parsed.hosts as string[],
    port: parsed.port,
    secret: parsed.secret,
  };
}

/**
 * Build the pairing endpoint URL from a validated payload.
 *
 * Uses {@link preferredAddress} (same IPv4-preference logic as the rest of
 * the networking layer) to pick the best reachable host from `payload.hosts`,
 * then assembles `https://<host>:<port>/v1/pair`.
 *
 * Returns `undefined` if no address is preferred (should not happen for a
 * valid payload, but handled defensively).
 */
export function pairingUrl(payload: PairingQRPayload): string | undefined {
  const host = preferredAddress(payload.hosts);
  if (!host) return undefined;

  // IPv6 addresses in URLs must be bracketed; IPv4 addresses are used as-is.
  const hostPart = host.includes(":") ? `[${host}]` : host;
  return `https://${hostPart}:${payload.port}/v1/pair`;
}
