/**
 * Typed errors for the network/protocol layer.
 *
 * The parsing and network code never carries translated text — it only throws
 * a {@link NetworkError} with a stable {@link NetworkErrorCode}. The UI layer
 * maps the code to a localized message via the i18n bundle, so protocol code
 * stays free of baked-in translations (see product decision #8).
 */

export type NetworkErrorCode =
  | "no_address"
  | "daemon_http"
  | "daemon_timeout"
  | "daemon_tls"
  | "response_invalid"
  | "response_missing"
  | "agent_invalid"
  | "agent_missing"
  | "focus_http"
  | "focus_timeout"
  | "focus_tls"
  | "history_http"
  | "history_timeout"
  | "history_tls"
  | "history_invalid"
  | "history_read"
  | "send_http"
  | "send_timeout"
  | "send_tls"
  | "send_failed"
  | "discovery_search_failed"
  | "discovery_resolve_failed"
  | "connect_failed"
  | "nearby_permission_denied"
  | "fingerprint_mismatch"
  | "unauthorized"
  | "revoked"
  | "pairing_failed"
  | "pairing_qr_invalid"
  | "not_credentials";

/** All defined error codes (runtime mirror of the union, used for exhaustive tests). */
export const NETWORK_ERROR_CODES: readonly NetworkErrorCode[] = [
  "no_address",
  "daemon_http",
  "daemon_timeout",
  "daemon_tls",
  "response_invalid",
  "response_missing",
  "agent_invalid",
  "agent_missing",
  "focus_http",
  "focus_timeout",
  "focus_tls",
  "history_http",
  "history_timeout",
  "history_tls",
  "history_invalid",
  "history_read",
  "send_http",
  "send_timeout",
  "send_tls",
  "send_failed",
  "discovery_search_failed",
  "discovery_resolve_failed",
  "connect_failed",
  "nearby_permission_denied",
  "fingerprint_mismatch",
  "unauthorized",
  "revoked",
  "pairing_failed",
  "pairing_qr_invalid",
  "not_credentials",
];

/** Error thrown by the daemon/agent data + network layer. Carries a stable code. */
export class NetworkError extends Error {
  readonly code: NetworkErrorCode;
  readonly status: number | undefined;
  readonly detail: string | undefined;

  constructor(code: NetworkErrorCode, statusOrDetail?: number | string) {
    const status = typeof statusOrDetail === "number" ? statusOrDetail : undefined;
    const detail = typeof statusOrDetail === "string" ? statusOrDetail : undefined;
    const message = detail ? `${code}: ${detail}` : code;
    super(message);
    this.name = "NetworkError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

/** Resolve an unknown thrown value to a stable code, falling back when it isn't ours. */
export function toErrorCode(error: unknown, fallback: NetworkErrorCode): NetworkErrorCode {
  return error instanceof NetworkError ? error.code : fallback;
}

/** Extract the HTTP status carried by a {@link NetworkError}, if any. */
export function toErrorStatus(error: unknown): number | undefined {
  return error instanceof NetworkError ? error.status : undefined;
}
