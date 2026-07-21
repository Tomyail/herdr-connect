import { assertDaemonSupported, parseAgentsResponse, type AgentsResponse } from "./agent-contract";
import type { DiscoveredService } from "./discovery";
import { NetworkError } from "./i18n/errors";
import type { NetworkErrorCode } from "./i18n/errors";
import { loadCredentials } from "./credentials";
import { pinnedFetch, PinnedFetchError } from "../modules/pinned-fetch";
import type { PairingQRPayload } from "./pairing";
import { pairingUrl } from "./pairing";
import { isIPv4, preferredAddress } from "./address";

const REQUEST_TIMEOUT_MS = 5_000;
const DAEMON_PORT = 9_808;

/** API/protocol version this app speaks. Sent on every request via
 *  X-Herdr-Connect-Client-Version so the daemon can reject clients that are
 *  too old (426 client_outdated). Must stay in sync with the daemon-side
 *  MinSupportedClientVersion (internal/demolan/auth.go). */
const CLIENT_API_VERSION = 1;
const CLIENT_VERSION_HEADER = "X-Herdr-Connect-Client-Version";

export interface AgentHistory {
  api_version: number;
  source_id: string;
  text: string;
  revision: number;
  truncated: boolean;
  refreshed_at: string;
}

/** Result of a successful `/v1/pair` call. */
export interface PairResult {
  apiVersion: number;
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

export function agentsUrl(address: string, port: number): string {
  return `https://${formatHost(address)}:${port}/v1/agents`;
}

/** SSE endpoint for live cursor/online change signals. See daemon sse.go. */
export function agentsEventsUrl(address: string, port: number): string {
  return `${agentsUrl(address, port)}/events`;
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
      port: DAEMON_PORT,
      txt: { path: "/v1/agents", api_version: "1" },
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
    [CLIENT_VERSION_HEADER]: String(CLIENT_API_VERSION),
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
      // 401 时解析 body 中的 error.code 区分“已撤销”(revoked) 和
      // 缺失/未知 token (unauthorized)。解析失败回退到 unauthorized。
      try {
        const errorBody = JSON.parse(response.body);
        if (errorBody?.error?.code === "revoked") {
          throw new NetworkError("revoked");
        }
      } catch (parseError) {
        if (parseError instanceof NetworkError) throw parseError;
        // JSON 解析失败或缺少 error.code，回退到 unauthorized。
      }
      throw new NetworkError("unauthorized");
    }
    if (response.status === 426) {
      // daemon 声明 app 版本过旧（X-Herdr-Connect-Client-Version 低于 daemon
      // MinSupportedClientVersion）。这是个终态：重试无意义，用户需要升级 app。
      throw new NetworkError("app_outdated");
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

export async function fetchAgents(
  service: DiscoveredService,
  _outerSignal?: AbortSignal,
): Promise<AgentsResponse> {
  const address = preferredAddress(service.addresses);
  if (!address) throw new NetworkError("no_address");

  const { fingerprint, token } = await requireCredentials();

  const response = await authPinnedFetch({
    url: agentsUrl(address, service.port),
    fingerprint,
    token,
    tlsErrorCode: "daemon_tls",
    timeoutErrorCode: "daemon_timeout",
    httpErrorCode: "daemon_http",
  });

  const data = parseAgentsResponse(JSON.parse(response.body));
  assertDaemonSupported(data.api_version);
  return data;
}

export async function focusAgent(
  service: DiscoveredService,
  sourceID: string,
): Promise<void> {
  const address = preferredAddress(service.addresses);
  if (!address) throw new NetworkError("no_address");

  const { fingerprint, token } = await requireCredentials();

  const baseURL = agentsUrl(address, service.port);

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

export async function interruptAgent(
  service: DiscoveredService,
  sourceID: string,
): Promise<void> {
  const address = preferredAddress(service.addresses);
  if (!address) throw new NetworkError("no_address");

  const { fingerprint, token } = await requireCredentials();

  const baseURL = agentsUrl(address, service.port);

  await authPinnedFetch({
    url: `${baseURL}/${encodeURIComponent(sourceID)}/interrupt`,
    fingerprint,
    token,
    method: "POST",
    tlsErrorCode: "interrupt_tls",
    timeoutErrorCode: "interrupt_timeout",
    httpErrorCode: "interrupt_http",
  });
}

export async function fetchAgentHistory(
  service: DiscoveredService,
  sourceID: string,
): Promise<AgentHistory> {
  const address = preferredAddress(service.addresses);
  if (!address) throw new NetworkError("no_address");

  const { fingerprint, token } = await requireCredentials();

  const baseURL = agentsUrl(address, service.port);

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
    typeof (value as Record<string, unknown>).api_version !== "number" ||
    typeof (value as Record<string, unknown>).source_id !== "string" ||
    typeof (value as Record<string, unknown>).text !== "string" ||
    typeof (value as Record<string, unknown>).revision !== "number" ||
    typeof (value as Record<string, unknown>).truncated !== "boolean" ||
    typeof (value as Record<string, unknown>).refreshed_at !== "string"
  ) {
    throw new NetworkError("history_invalid");
  }
  const history = value as AgentHistory;
  assertDaemonSupported(history.api_version);
  return history;
}

export async function sendAgentMessage(
  service: DiscoveredService,
  sourceID: string,
  text: string,
): Promise<void> {
  const address = preferredAddress(service.addresses);
  if (!address) throw new NetworkError("no_address");

  const { fingerprint, token } = await requireCredentials();

  const baseURL = agentsUrl(address, service.port);

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
        [CLIENT_VERSION_HEADER]: String(CLIENT_API_VERSION),
      },
      body: JSON.stringify({ device_name: deviceName, secret: payload.secret }),
      timeoutMs: REQUEST_TIMEOUT_MS,
    });

    if (response.status === 400) {
      throw new NetworkError("pairing_failed");
    }
    if (response.status === 426) {
      throw new NetworkError("app_outdated");
    }
    if (response.status < 200 || response.status >= 300) {
      throw new NetworkError("pairing_failed", response.status);
    }

    const data: unknown = JSON.parse(response.body);
    if (
      typeof data !== "object" ||
      data === null ||
      typeof (data as Record<string, unknown>).api_version !== "number" ||
      typeof (data as Record<string, unknown>).device_id !== "string" ||
      typeof (data as Record<string, unknown>).token !== "string" ||
      typeof (data as Record<string, unknown>).device_name !== "string" ||
      typeof (data as Record<string, unknown>).fingerprint !== "string"
    ) {
      throw new NetworkError("pairing_failed");
    }

    const record = data as Record<string, unknown>;
    const apiVersion = record.api_version as number;
    assertDaemonSupported(apiVersion);

    return {
      apiVersion,
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
