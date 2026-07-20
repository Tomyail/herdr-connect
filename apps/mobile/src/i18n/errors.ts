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
  | "response_invalid"
  | "response_missing"
  | "agent_invalid"
  | "agent_missing"
  | "focus_http"
  | "focus_timeout"
  | "history_http"
  | "history_timeout"
  | "history_invalid"
  | "history_read"
  | "send_http"
  | "send_timeout"
  | "send_failed"
  | "discovery_search_failed"
  | "discovery_resolve_failed"
  | "connect_failed"
  | "nearby_permission_denied";

/** All defined error codes (runtime mirror of the union, used for exhaustive tests). */
export const NETWORK_ERROR_CODES: readonly NetworkErrorCode[] = [
  "no_address",
  "daemon_http",
  "daemon_timeout",
  "response_invalid",
  "response_missing",
  "agent_invalid",
  "agent_missing",
  "focus_http",
  "focus_timeout",
  "history_http",
  "history_timeout",
  "history_invalid",
  "history_read",
  "send_http",
  "send_timeout",
  "send_failed",
  "discovery_search_failed",
  "discovery_resolve_failed",
  "connect_failed",
  "nearby_permission_denied",
];

/** Error thrown by the daemon/agent data + network layer. Carries a stable code. */
export class NetworkError extends Error {
  readonly code: NetworkErrorCode;
  readonly status: number | undefined;

  constructor(code: NetworkErrorCode, status?: number) {
    super(code);
    this.name = "NetworkError";
    this.code = code;
    this.status = status;
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
