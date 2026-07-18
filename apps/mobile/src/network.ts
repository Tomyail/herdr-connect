import type { Service } from "@inthepocket/react-native-service-discovery";

import { parseDemoAgentsResponse, type DemoAgentsResponse } from "./demo-contract";
import { NetworkError } from "./i18n/errors";

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

export function isIPv4(address: string): boolean {
  const parts = address.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}

export function preferredAddress(addresses: readonly string[]): string | undefined {
  return addresses.find(isIPv4) ?? addresses[0];
}

export function demoAgentsUrl(address: string, port: number): string {
  const host = isIPv4(address)
    ? address
    : `[${address.replace("%", "%25")}]`;
  return `http://${host}:${port}/v1/demo/agents`;
}

export function serviceKey(service: Service): string {
  return `${service.name}|${service.type}|${service.domain}`;
}

export function devServerFallbackService(scriptURL: string | undefined): Service | undefined {
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

export async function fetchDemoAgents(
  service: Service,
  outerSignal?: AbortSignal,
): Promise<DemoAgentsResponse> {
  const address = preferredAddress(service.addresses);
  if (!address) throw new NetworkError("no_address");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abortFromOuter = () => controller.abort();
  outerSignal?.addEventListener("abort", abortFromOuter, { once: true });

  try {
    const response = await fetch(demoAgentsUrl(address, service.port), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new NetworkError("daemon_http", response.status);
    return parseDemoAgentsResponse(await response.json());
  } catch (error) {
    if (controller.signal.aborted && !outerSignal?.aborted) {
      throw new NetworkError("daemon_timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    outerSignal?.removeEventListener("abort", abortFromOuter);
  }
}

export async function focusDemoAgent(
  service: Service,
  sourceID: string,
): Promise<void> {
  const address = preferredAddress(service.addresses);
  if (!address) throw new NetworkError("no_address");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const baseURL = demoAgentsUrl(address, service.port);
  try {
    const response = await fetch(`${baseURL}/${encodeURIComponent(sourceID)}/focus`, {
      method: "POST",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new NetworkError("focus_http", response.status);
  } catch (error) {
    if (controller.signal.aborted) throw new NetworkError("focus_timeout");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchDemoAgentHistory(
  service: Service,
  sourceID: string,
): Promise<DemoAgentHistory> {
  const address = preferredAddress(service.addresses);
  if (!address) throw new NetworkError("no_address");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const baseURL = demoAgentsUrl(address, service.port);
  try {
    const response = await fetch(`${baseURL}/${encodeURIComponent(sourceID)}/history`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new NetworkError("history_http", response.status);
    const value: unknown = await response.json();
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
  } catch (error) {
    if (controller.signal.aborted) throw new NetworkError("history_timeout");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendDemoAgentMessage(
  service: Service,
  sourceID: string,
  text: string,
): Promise<void> {
  const address = preferredAddress(service.addresses);
  if (!address) throw new NetworkError("no_address");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const baseURL = demoAgentsUrl(address, service.port);
  try {
    const response = await fetch(`${baseURL}/${encodeURIComponent(sourceID)}/messages`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    if (!response.ok) throw new NetworkError("send_http", response.status);
  } catch (error) {
    if (controller.signal.aborted) throw new NetworkError("send_timeout");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
