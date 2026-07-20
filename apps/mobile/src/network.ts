import { parseDemoAgentsResponse, type DemoAgentsResponse } from "./demo-contract";
import type { DiscoveredService } from "./discovery";
import { NetworkError } from "./i18n/errors";
import type { NetworkErrorCode } from "./i18n/errors";
import { loadCredentials } from "./credentials";
import { pinnedFetch, PinnedFetchError } from "../modules/pinned-fetch";
import type { PairingQRPayload } from "./pairing";
import { pairingUrl } from "./pairing";
import { isIPv4, preferredAddress } from "./address";

const REQUEST_TIMEOUT_MS = 5_000;
const DEMO_DAEMON_PORT = 9_808;

export interface DemoAgentHistory {
  demo_version: number;
  source_id: string;
  text: string;
  revision: number;
  truncated: boolean;
  refreshed_at: string;
}

/** Result of a successful `/v1/pair` call. */
export interface PairResult {
  deviceId: string;
  token: string;
  deviceName: string;
  fingerprint: string;
}

export { isIPv4, preferredAddress };

function formatHost(address: string): string {
  return isIPv4(address)
    ? address
    : `[${address.replace("%", "%25")}]`;
}

export function demoAgentsUrl(address: string, port: number): string {
  return `https://${formatHost(address)}:${port}/v1/demo/agents`;
}

export function serviceKey(service: DiscoveredService): string {
  return `${service.name}|${service.type}|${service.domain}`;
}

export function devServerFallbackService(scriptURL: string | undefined): DiscoveredService | undefined {
  if (!scriptURL) return undefined;

  try {
    const host = new URL(scriptURL).hostname;
    if (!host || host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return undefined;
    }
    return {
      name: "Metro dev direct",
      type: "_herdr-connect._tcp.",
      domain: "local.",
      hostName: host,
      addresses: [host],
      port: DEMO_DAEMON_PORT,
      txt: { path: "/v1/demo/agents", demo_version: "0" },
    };
  } catch {
    return undefined;
  }
}

interface AuthRequestParams {
  url: string;
  fingerprint: string;
  token: string;
  method?: string;
  body?: string;
  extraHeaders?: Record<string, string>;
  tlsErrorCode: NetworkErrorCode;
  timeoutErrorCode: NetworkErrorCode;
  httpErrorCode: NetworkErrorCode;
}

/** Map a {@link PinnedFetchError} to the appropriate {@link NetworkError}, preserving the original detail. */
function mapPinnedFetchError(
  error: PinnedFetchError,
  tlsErrorCode: NetworkErrorCode,
  timeoutErrorCode: NetworkErrorCode,
): NetworkError {
  switch (error.code) {
    case "fingerprint_mismatch":
      return new NetworkError("fingerprint_mismatch");
    case "timeout":
      return new NetworkError(timeoutErrorCode);
    case "tls_handshake_failed":
    case "network_error":
    case "invalid_url":
    case "unsupported_platform":
      return new NetworkError(tlsErrorCode, error.message);
  }
}

/**
 * Issue an authenticated pinned request to the daemon.
 *
 * Loads credentials internally, calls pinnedFetch with the daemon's pinned
 * fingerprint and bearer token, and maps transport-level errors to endpoint-
 * specific {@link NetworkError} codes.
 */
async function authPinnedFetch(params: AuthRequestParams): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${params.token}`,
    ...params.extraHeaders,
  };

  try {
    const response = await pinnedFetch(params.url, params.fingerprint, {
      method: params.method ?? "GET",
      headers,
      body: params.body,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });

    if (response.status === 401) {
      throw new NetworkError("unauthorized");
    }
    if (response.status < 200 || response.status >= 300) {
      throw new NetworkError(params.httpErrorCode, response.status);
    }

    return response;
  } catch (error) {
    if (error instanceof NetworkError) throw error;
    if (error instanceof PinnedFetchError) {
      throw mapPinnedFetchError(error, params.tlsErrorCode, params.timeoutErrorCode);
    }
    throw error;
  }
}

/** Ensure credentials exist, throwing a typed error if not. */
async function requireCredentials(): Promise<{ fingerprint: string; token: string }> {
  const creds = await loadCredentials();
  if (!creds) throw new NetworkError("not_credentials");
  return { fingerprint: creds.fingerprint, token: creds.token };
}

export async function fetchDemoAgents(
  service: DiscoveredService,
  _outerSignal?: AbortSignal,
): Promise<DemoAgentsResponse> {
  const address = preferredAddress(service.addresses);
  if (!address) throw new NetworkError("no_address");

  const { fingerprint, token } = await requireCredentials();

  const response = await authPinnedFetch({
    url: demoAgentsUrl(address, service.port),
    fingerprint,
    token,
    tlsErrorCode: "daemon_tls",
    timeoutErrorCode: "daemon_timeout",
    httpErrorCode: "daemon_http",
  });

  return parseDemoAgentsResponse(JSON.parse(response.body));
}

export async function focusDemoAgent(
  service: DiscoveredService,
  sourceID: string,
): Promise<void> {
  const address = preferredAddress(service.addresses);
  if (!address) throw new NetworkError("no_address");

  const { fingerprint, token } = await requireCredentials();

  const baseURL = demoAgentsUrl(address, service.port);

  await authPinnedFetch({
    url: `${baseURL}/${encodeURIComponent(sourceID)}/focus`,
    fingerprint,
    token,
    method: "POST",
    tlsErrorCode: "focus_tls",
    timeoutErrorCode: "focus_timeout",
    httpErrorCode: "focus_http",
  });
}

export async function fetchDemoAgentHistory(
  service: DiscoveredService,
  sourceID: string,
): Promise<DemoAgentHistory> {
  const address = preferredAddress(service.addresses);
  if (!address) throw new NetworkError("no_address");

  const { fingerprint, token } = await requireCredentials();

  const baseURL = demoAgentsUrl(address, service.port);

  const response = await authPinnedFetch({
    url: `${baseURL}/${encodeURIComponent(sourceID)}/history`,
    fingerprint,
    token,
    tlsErrorCode: "history_tls",
    timeoutErrorCode: "history_timeout",
    httpErrorCode: "history_http",
  });

  const value: unknown = JSON.parse(response.body);
  if (
    typeof value !== "object" || value === null ||
    typeof (value as Record<string, unknown>).demo_version !== "number" ||
    typeof (value as Record<string, unknown>).source_id !== "string" ||
    typeof (value as Record<string, unknown>).text !== "string" ||
    typeof (value as Record<string, unknown>).revision !== "number" ||
    typeof (value as Record<string, unknown>).truncated !== "boolean" ||
    typeof (value as Record<string, unknown>).refreshed_at !== "string"
  ) {
    throw new NetworkError("history_invalid");
  }
  return value as DemoAgentHistory;
}

export async function sendDemoAgentMessage(
  service: DiscoveredService,
  sourceID: string,
  text: string,
): Promise<void> {
  const address = preferredAddress(service.addresses);
  if (!address) throw new NetworkError("no_address");

  const { fingerprint, token } = await requireCredentials();

  const baseURL = demoAgentsUrl(address, service.port);

  await authPinnedFetch({
    url: `${baseURL}/${encodeURIComponent(sourceID)}/messages`,
    fingerprint,
    token,
    method: "POST",
    body: JSON.stringify({ text }),
    extraHeaders: { "Content-Type": "application/json" },
    tlsErrorCode: "send_tls",
    timeoutErrorCode: "send_timeout",
    httpErrorCode: "send_http",
  });
}

/**
 * Pair this device with a daemon using the QR payload.
 *
 * The QR fingerprint (`payload.fp`) is trusted because physical proximity to
 * the terminal screen constitutes out-of-band confirmation. No stored
 * credentials are consulted — this is the trust-on-first-use step.
 *
 * Returns the credentials issued by `/v1/pair`, which the caller should
 * persist via {@link saveCredentials}.
 */
export async function pairDaemon(
  payload: PairingQRPayload,
  deviceName: string,
): Promise<PairResult> {
  const url = pairingUrl(payload);
  if (!url) throw new NetworkError("no_address");

  try {
    const response = await pinnedFetch(url, payload.fp, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ device_name: deviceName, secret: payload.secret }),
      timeoutMs: REQUEST_TIMEOUT_MS,
    });

    if (response.status === 400) {
      throw new NetworkError("pairing_failed");
    }
    if (response.status < 200 || response.status >= 300) {
      throw new NetworkError("pairing_failed", response.status);
    }

    const data: unknown = JSON.parse(response.body);
    if (
      typeof data !== "object" ||
      data === null ||
      typeof (data as Record<string, unknown>).device_id !== "string" ||
      typeof (data as Record<string, unknown>).token !== "string" ||
      typeof (data as Record<string, unknown>).device_name !== "string" ||
      typeof (data as Record<string, unknown>).fingerprint !== "string"
    ) {
      throw new NetworkError("pairing_failed");
    }

    const record = data as Record<string, unknown>;
    return {
      deviceId: record.device_id as string,
      token: record.token as string,
      deviceName: record.device_name as string,
      fingerprint: record.fingerprint as string,
    };
  } catch (error) {
    if (error instanceof NetworkError) throw error;
    if (error instanceof PinnedFetchError) {
      throw mapPinnedFetchError(error, "daemon_tls", "daemon_timeout");
    }
    throw error;
  }
}
