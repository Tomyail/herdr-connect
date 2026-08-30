import type { Agent, AgentsResponse } from "./agent-contract";
import type { ConnectionValue } from "./connection";
import type { DiscoveredService } from "./discovery";
import type { DeviceCredentials } from "./paired-instances";
import type { AgentHistory } from "./network";

export type ScreenshotSceneName = "agents" | "detail" | "settings";

export function parseScreenshotScene(value: string | undefined): ScreenshotSceneName | undefined {
  return value === "agents" || value === "detail" || value === "settings" ? value : undefined;
}

const SCREENSHOT_SERVICE: DiscoveredService = {
  name: "MacBook Pro · Herdr",
  type: "_herdr-connect._tcp.",
  domain: "local.",
  hostName: "herdr.local.",
  addresses: ["192.168.1.42"],
  port: 9808,
  txt: { api_version: "1" },
};

const SCREENSHOT_AGENTS: readonly Agent[] = [
  {
    source_id: "screenshot-herdr-connect",
    display_name: "Herdr Connect",
    workspace_label: "herdr-connect",
    tab_label: "mobile",
    agent_name: "claude",
    revision: 42,
    interaction_state: "working",
    turn_outcome: null,
  },
  {
    source_id: "screenshot-openwiki",
    display_name: "OpenWiki Brain",
    workspace_label: "openwiki",
    tab_label: "main",
    agent_name: "codex",
    revision: 18,
    interaction_state: "ready_input",
    turn_outcome: "succeeded",
  },
  {
    source_id: "screenshot-production",
    display_name: "Production Infra",
    workspace_label: "production-infra",
    tab_label: "deploy",
    agent_name: "gemini",
    revision: 7,
    interaction_state: "blocked",
    turn_outcome: null,
  },
  {
    source_id: "screenshot-notes",
    display_name: "Release Notes",
    workspace_label: "herdr-connect",
    tab_label: "docs",
    agent_name: "claude",
    revision: 12,
    interaction_state: "ready_input",
    turn_outcome: null,
  },
];

const SCREENSHOT_RESPONSE: AgentsResponse = {
  api_version: 1,
  source_name: "Herdr",
  source_online: true,
  refreshed_at: "2026-01-15T09:41:00.000Z",
  agents: [...SCREENSHOT_AGENTS],
};

const SCREENSHOT_INSTANCES: readonly DeviceCredentials[] = [
  {
    fingerprint: "screenshot-fingerprint-macbook",
    deviceId: "screenshot-device-macbook",
    token: "screenshot-token-macbook",
    deviceName: "MacBook Pro",
    pairedAt: "2026-01-15T09:41:00.000Z",
  },
  {
    fingerprint: "screenshot-fingerprint-studio",
    deviceId: "screenshot-device-studio",
    token: "screenshot-token-studio",
    deviceName: "Mac Studio",
    pairedAt: "2026-01-14T09:41:00.000Z",
  },
];

const SCREENSHOT_HISTORY_COPY = {
  en: [
    "## Herdr Connect",
    "",
    "Connected to the local daemon.",
    "",
    "### Recent activity",
    "",
    "- Reviewed the pairing flow",
    "- Added multi-installation switching",
    "- Waiting for your next instruction",
  ].join("\n"),
  "zh-Hans": [
    "## Herdr Connect",
    "",
    "已连接到本地 daemon。",
    "",
    "### 最近活动",
    "",
    "- 检查配对流程",
    "- 添加多 Installation 切换",
    "- 等待你的下一条指令",
  ].join("\n"),
} as const;

export function createScreenshotHistory(locale: "en" | "zh-Hans"): AgentHistory {
  return {
    api_version: 1,
    source_id: SCREENSHOT_AGENTS[0]!.source_id,
    revision: 42,
    truncated: false,
    refreshed_at: SCREENSHOT_RESPONSE.refreshed_at,
    text: SCREENSHOT_HISTORY_COPY[locale],
  };
}

export const SCREENSHOT_HISTORY = createScreenshotHistory("en");

/**
 * A stable, connected value for screenshot-only UI runs. All callbacks are
 * deliberately no-ops: screenshot scenes must never touch a real daemon or
 * mutate credentials on the developer's machine.
 */
export function createScreenshotConnection(): ConnectionValue {
  return {
    state: {
      phase: "connected",
      service: SCREENSHOT_SERVICE,
      data: SCREENSHOT_RESPONSE,
    },
    streamStatus: "live",
    refresh: async () => {},
    switchAgent: async () => {},
    unpair: async () => {},
    instances: [...SCREENSHOT_INSTANCES],
    activeFingerprint: SCREENSHOT_INSTANCES[0]!.fingerprint,
    switchInstance: async () => {},
    instanceStates: Object.fromEntries(
      SCREENSHOT_INSTANCES.map((instance) => [
        instance.fingerprint,
        { phase: "connected", streamStatus: "live" },
      ]),
    ) as ConnectionValue["instanceStates"],
    forgetInstance: async () => ({ outcome: "forgotten" }),
  };
}

export function screenshotAgent(): Agent {
  return SCREENSHOT_AGENTS[0]!;
}

export function screenshotService(): DiscoveredService {
  return SCREENSHOT_SERVICE;
}
