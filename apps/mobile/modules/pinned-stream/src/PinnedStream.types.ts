/**
 * pinned-stream — iOS-only local Expo module that opens a long-lived HTTPS
 * Server-Sent Events stream pinned to a self-signed certificate fingerprint.
 *
 * Companion to pinned-fetch (one-shot request). Both modules share the Swift
 * `PinnedTrustEvaluator` for the trust decision; the fingerprint IS the trust
 * decision (no standard CA-chain or hostname validation). See
 * docs/security/lan-tls-pairing.md.
 *
 * The native layer only transports raw SSE `data:` payloads to JS as strings;
 * protocol semantics (parsing {cursor, online}) live in TS, matching the
 * "native only transports, protocol parsing in JS" style of network.ts.
 */

export type PinnedStreamErrorCode =
  /** Server certificate fingerprint does not match the pinned value. */
  | "fingerprint_mismatch"
  /** TLS handshake or underlying connection failed. */
  | "tls_handshake_failed"
  /** No data received within the keepalive window (dead-connection detection). */
  | "timeout"
  /** Any other network-level failure. */
  | "network_error"
  /** The URL or fingerprint could not be parsed. */
  | "invalid_url"
  /** This module is iOS-only; other platforms cannot open a pinned stream. */
  | "unsupported_platform";

export type PinnedStreamErrorOptions = {
  readonly code: PinnedStreamErrorCode;
  readonly message: string;
};

/**
 * Thrown by {@link startStream} for synchronous setup failures (unsupported
 * platform / module not linked / invalid URL). Stream-lifetime failures are
 * reported via {@link PinnedStreamHandle.onError} instead, using the same code
 * surface.
 */
export class PinnedStreamError extends Error {
  readonly code: PinnedStreamErrorCode;

  constructor({ code, message }: PinnedStreamErrorOptions) {
    super(message);
    this.name = "PinnedStreamError";
    this.code = code;
    Object.setPrototypeOf(this, PinnedStreamError.prototype);
  }
}
