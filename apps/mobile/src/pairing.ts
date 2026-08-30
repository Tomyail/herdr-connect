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
 * 为 payload.hosts 中的每个地址生成 `https://<host>:<port>/v1/pair`，保持
 * daemon 给出的顺序（IPv4 升序在前）。可达性由调用方逐个尝试回退决定
 * （见 withHostFallback）——多宿主 daemon 的 hosts 会包含手机不可达的
 * 地址（Docker 网桥、VPN 等），顺序不携带可达性信息。
 *
 * IPv6 地址在 URL 中需括号包裹；IPv4 原样使用。
 */
export function pairingUrls(payload: PairingQRPayload): string[] {
  return payload.hosts.map((host) => {
    const hostPart = host.includes(":") ? `[${host}]` : host;
    return `https://${hostPart}:${payload.port}/v1/pair`;
  });
}
