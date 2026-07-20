/**
 * pinned-fetch — iOS-only local Expo module that performs HTTPS requests with
 * self-signed certificate fingerprint pinning.
 *
 * See docs/security/lan-tls-pairing.md for the trust model this module enforces:
 * the LAN daemon presents a self-signed ECDSA P-256 certificate whose SHA-256
 * fingerprint is the installation identity. Devices pin that fingerprint and do
 * NOT perform standard CA-chain or hostname validation. A TLS handshake against
 * an attacker lacking the private key cannot succeed.
 */

export type PinnedFetchOptions = {
  /** HTTP method. Defaults to `"GET"`. */
  readonly method?: string;
  /** Request headers. */
  readonly headers?: Record<string, string>;
  /** Request body (UTF-8 string). */
  readonly body?: string;
  /** Per-request timeout in milliseconds. Defaults to 10000. */
  readonly timeoutMs?: number;
};

export type PinnedFetchResponse = {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
};

/**
 * Error codes. The set is fixed; do not add granularity that leaks server state
 * to an unauthenticated caller (mirrors the daemon's uniform-failure policy).
 */
export type PinnedFetchErrorCode =
  | "fingerprint_mismatch"
  | "tls_handshake_failed"
  | "timeout"
  | "network_error"
  | "invalid_url"
  | "unsupported_platform";

export type PinnedFetchErrorOptions = {
  readonly code: PinnedFetchErrorCode;
  readonly message: string;
};

/**
 * Thrown by {@link pinnedFetch} for every failure mode. `code` is one of
 * {@link PinnedFetchErrorCode}; `message` carries a short human-readable detail.
 */
export class PinnedFetchError extends Error {
  readonly code: PinnedFetchErrorCode;

  constructor({ code, message }: PinnedFetchErrorOptions) {
    super(message);
    this.name = "PinnedFetchError";
    this.code = code;
    // Restore prototype chain across the ES5/ES6 compile boundary.
    Object.setPrototypeOf(this, PinnedFetchError.prototype);
  }
}
