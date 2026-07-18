/**
 * Translation bundles + type-safe lookup.
 *
 * English is the source of truth for {@link MessageKey}; the zh-Hans bundle is
 * typed as `Record<MessageKey, string>` so the compiler guarantees both bundles
 * expose exactly the same keys. Error text lives in a separate code-keyed table
 * so protocol/network code never depends on UI message keys.
 */

import type { NetworkErrorCode } from "./errors";
import { DEFAULT_LOCALE, type ResolvedLocale } from "./locale";

const en = {
  "common.unknown": "Unknown",

  "tab.agents": "Agents",
  "tab.settings": "Settings",

  "agents.screenTitle": "Agents overview",
  "agents.refreshA11y": "Refresh daemon and agent list",
  "agents.status.discovering": "Discovering daemon",
  "agents.status.notFound": "No daemon found",
  "agents.status.failed": "Connection failed",
  "agents.status.connected": "Connected",
  "agents.detail.discovering": "Make sure your iPhone and daemon are on the same local network.",
  "agents.detail.notFound": "Check that the daemon is running and broadcasting the service.",
  "agents.summary.sourceOnline": "source online",
  "agents.summary.sourceOffline": "source offline",
  "agents.summary.count": "{count}",
  "agents.empty": "No agents",
  "agents.placeholder.title": "Waiting for local connection",
  "agents.placeholder.text":
    "Once a service is discovered, a daemon is selected automatically and the latest agent state is loaded.",
  "agents.row.unnamed": "Unnamed agent",
  "agents.row.switchA11y": "Switch to {title} {tab}",
  "agents.focus.switching": "Switching\u2026",
  "agents.focus.switched": "Switched",
  "agents.focus.failed": "Switch failed",

  "interaction.working": "Working",
  "interaction.blocked": "Blocked",
  "interaction.ready_input": "Awaiting input",
  "interaction.unknown": "Unknown",

  "detail.historyTitle": "History",
  "detail.historyMeta.truncated": "Recent excerpt",
  "detail.historyMeta.recent": "Recent",
  "detail.loadingHistory": "Loading recent history",
  "detail.emptyHistory": "No history to display yet.",
  "detail.refreshA11y": "Refresh history",
  "detail.inputA11y": "Message to send to the agent",
  "detail.inputPlaceholder": "Type a message to send to the desktop\u2026",
  "detail.sendA11y": "Send message",
  "detail.send": "Send",
  "detail.sentToDesktop": "Sent to desktop",
  "detail.back": "Back",

  "settings.screenTitle": "Settings",
  "settings.section.general": "General",
  "settings.section.connection": "Connection",
  "settings.section.discovery": "Discovery",
  "settings.section.about": "About",
  "settings.section.notifications": "Notifications",
  "settings.row.status": "Status",
  "settings.value.connected": "Connected",
  "settings.value.notConnected": "Not connected",
  "settings.row.daemon": "daemon",
  "settings.row.address": "Address",
  "settings.row.source": "Source",
  "settings.row.sourceStatus": "Source status",
  "settings.value.online": "Online",
  "settings.value.offline": "Offline",
  "settings.row.serviceType": "Service type",
  "settings.row.discoveryMethod": "Discovery method",
  "settings.value.discoveryMethod": "LAN Bonjour / NSD",
  "settings.row.app": "App",
  "settings.row.version": "Version",
  "settings.row.language": "Language",
  "settings.row.doneSound": "Completion sound",
  "settings.row.notifyWhileViewing": "Also notify while viewing",
  "settings.value.languageSystem": "System default",

  "language.title": "Language",
  "language.option.system": "System default",
  "language.option.zhHans": "\u7B80\u4F53\u4E2D\u6587",
  "language.option.en": "English",

  "settings.row.appearance": "Appearance",
  "appearance.title": "Appearance",
  "appearance.option.system": "System default",
  "appearance.option.light": "Light",
  "appearance.option.dark": "Dark",

  "permission.android.title": "Allow discovering nearby Herdr daemons",
  "permission.android.message":
    "Herdr Connect needs access to nearby devices to discover and connect to a Mac on the same local network.",
  "permission.android.allow": "Allow",
  "permission.android.deny": "Don't allow",
} as const;

export type MessageKey = keyof typeof en;

const zhHans: Record<MessageKey, string> = {
  "common.unknown": "\u672A\u77E5",

  "tab.agents": "Agents",
  "tab.settings": "\u8BBE\u7F6E",

  "agents.screenTitle": "Agent \u6982\u89C8",
  "agents.refreshA11y": "\u5237\u65B0 daemon \u4E0E Agent \u5217\u8868",
  "agents.status.discovering": "\u6B63\u5728\u53D1\u73B0 daemon",
  "agents.status.notFound": "\u672A\u53D1\u73B0 daemon",
  "agents.status.failed": "\u8FDE\u63A5\u5931\u8D25",
  "agents.status.connected": "\u5DF2\u8FDE\u63A5",
  "agents.detail.discovering": "\u8BF7\u786E\u4FDD iPhone \u4E0E daemon \u4F4D\u4E8E\u540C\u4E00\u5C40\u57DF\u7F51",
  "agents.detail.notFound": "\u68C0\u67E5 daemon \u662F\u5426\u5DF2\u542F\u52A8\u5E76\u5E7F\u64AD\u670D\u52A1",
  "agents.summary.sourceOnline": "\u6765\u6E90\u5728\u7EBF",
  "agents.summary.sourceOffline": "\u6765\u6E90\u79BB\u7EBF",
  "agents.summary.count": "{count} \u4E2A",
  "agents.empty": "\u5F53\u524D\u6CA1\u6709 Agent",
  "agents.placeholder.title": "\u7B49\u5F85\u672C\u5730\u8FDE\u63A5",
  "agents.placeholder.text":
    "\u53D1\u73B0\u670D\u52A1\u540E\u4F1A\u81EA\u52A8\u9009\u62E9\u4E00\u4E2A daemon\uFF0C\u5E76\u8BFB\u53D6\u6700\u65B0\u7684 Agent \u72B6\u6001\u3002",
  "agents.row.unnamed": "\u672A\u547D\u540D Agent",
  "agents.row.switchA11y": "\u5207\u6362\u5230 {title} {tab}",
  "agents.focus.switching": "\u5207\u6362\u4E2D\u2026",
  "agents.focus.switched": "\u5DF2\u5207\u6362",
  "agents.focus.failed": "\u5207\u6362\u5931\u8D25",

  "interaction.working": "\u5DE5\u4F5C\u4E2D",
  "interaction.blocked": "\u5DF2\u963B\u585E",
  "interaction.ready_input": "\u7B49\u5F85\u8F93\u5165",
  "interaction.unknown": "\u672A\u77E5",

  "detail.historyTitle": "\u5386\u53F2\u6D88\u606F",
  "detail.historyMeta.truncated": "\u8FD1\u671F\u622A\u9762",
  "detail.historyMeta.recent": "\u8FD1\u671F\u8BB0\u5F55",
  "detail.loadingHistory": "\u6B63\u5728\u8BFB\u53D6\u8FD1\u671F\u8BB0\u5F55",
  "detail.emptyHistory": "\u5F53\u524D\u6CA1\u6709\u53EF\u663E\u793A\u7684\u5386\u53F2\u8BB0\u5F55\u3002",
  "detail.refreshA11y": "\u5237\u65B0\u5386\u53F2",
  "detail.inputA11y": "\u53D1\u9001\u7ED9 Agent \u7684\u6D88\u606F",
  "detail.inputPlaceholder": "\u8F93\u5165\u5185\u5BB9\u53D1\u9001\u5230\u684C\u9762\u7AEF\u2026",
  "detail.sendA11y": "\u53D1\u9001\u6D88\u606F",
  "detail.send": "\u53D1\u9001",
  "detail.sentToDesktop": "\u5DF2\u53D1\u9001\u5230\u684C\u9762\u7AEF",
  "detail.back": "\u8FD4\u56DE",

  "settings.screenTitle": "\u8BBE\u7F6E",
  "settings.section.general": "\u901A\u7528",
  "settings.section.connection": "\u8FDE\u63A5",
  "settings.section.discovery": "\u53D1\u73B0",
  "settings.section.about": "\u5173\u4E8E",
  "settings.section.notifications": "\u901A\u77E5",
  "settings.row.status": "\u72B6\u6001",
  "settings.value.connected": "\u5DF2\u8FDE\u63A5",
  "settings.value.notConnected": "\u672A\u8FDE\u63A5",
  "settings.row.daemon": "daemon",
  "settings.row.address": "\u5730\u5740",
  "settings.row.source": "\u6765\u6E90",
  "settings.row.sourceStatus": "\u6765\u6E90\u72B6\u6001",
  "settings.value.online": "\u5728\u7EBF",
  "settings.value.offline": "\u79BB\u7EBF",
  "settings.row.serviceType": "\u670D\u52A1\u7C7B\u578B",
  "settings.row.discoveryMethod": "\u53D1\u73B0\u65B9\u5F0F",
  "settings.value.discoveryMethod": "\u5C40\u57DF\u7F51 Bonjour / NSD",
  "settings.row.app": "\u5E94\u7528",
  "settings.row.version": "\u7248\u672C",
  "settings.row.language": "\u8BED\u8A00",
  "settings.row.doneSound": "\u5B8C\u6210\u63D0\u793A\u97F3",
  "settings.row.notifyWhileViewing": "\u67E5\u770B\u65F6\u4E5F\u63D0\u793A",
  "settings.value.languageSystem": "\u8DDF\u968F\u7CFB\u7EDF",

  "language.title": "\u8BED\u8A00",
  "language.option.system": "\u8DDF\u968F\u7CFB\u7EDF",
  "language.option.zhHans": "\u7B80\u4F53\u4E2D\u6587",
  "language.option.en": "English",

  "settings.row.appearance": "\u5916\u89C2",
  "appearance.title": "\u5916\u89C2",
  "appearance.option.system": "\u8DDF\u968F\u7CFB\u7EDF",
  "appearance.option.light": "\u6D45\u8272",
  "appearance.option.dark": "\u6DF1\u8272",

  "permission.android.title": "\u5141\u8BB8\u53D1\u73B0\u9644\u8FD1\u7684 Herdr daemon",
  "permission.android.message":
    "Herdr Connect \u9700\u8981\u8BBF\u95EE\u9644\u8FD1\u8BBE\u5907\uFF0C\u4EE5\u53D1\u73B0\u5E76\u8FDE\u63A5\u540C\u4E00\u5C40\u57DF\u7F51\u4E2D\u7684 Mac\u3002",
  "permission.android.allow": "\u5141\u8BB8",
  "permission.android.deny": "\u6682\u4E0D\u5141\u8BB8",
};

export const messageBundles: Record<ResolvedLocale, Record<MessageKey, string>> = {
  en,
  "zh-Hans": zhHans,
};

const errorEn: Record<NetworkErrorCode, string> = {
  no_address: "No available network address for the service",
  daemon_http: "daemon returned HTTP {status}",
  daemon_timeout: "Timed out connecting to daemon",
  response_invalid: "Invalid daemon response format",
  response_missing: "Daemon response is missing required fields",
  agent_invalid: "Invalid agent data format",
  agent_missing: "Agent is missing required fields",
  focus_http: "Failed to switch agent (HTTP {status})",
  focus_timeout: "Timed out switching agent",
  history_http: "Failed to read history (HTTP {status})",
  history_timeout: "Timed out reading history",
  history_invalid: "Invalid history response format",
  history_read: "Unable to read history",
  send_http: "Failed to send (HTTP {status})",
  send_timeout: "Timed out sending message",
  send_failed: "Failed to send",
  connect_failed: "Unable to connect to daemon",
  nearby_permission_denied: "Nearby devices permission not granted",
};

const errorZhHans: Record<NetworkErrorCode, string> = {
  no_address: "\u670D\u52A1\u6CA1\u6709\u53EF\u7528\u7F51\u7EDC\u5730\u5740",
  daemon_http: "daemon \u8FD4\u56DE HTTP {status}",
  daemon_timeout: "\u8FDE\u63A5 daemon \u8D85\u65F6",
  response_invalid: "daemon \u54CD\u5E94\u683C\u5F0F\u65E0\u6548",
  response_missing: "daemon \u54CD\u5E94\u7F3A\u5C11\u5FC5\u8981\u5B57\u6BB5",
  agent_invalid: "Agent \u6570\u636E\u683C\u5F0F\u65E0\u6548",
  agent_missing: "Agent \u7F3A\u5C11\u5FC5\u8981\u5B57\u6BB5",
  focus_http: "\u5207\u6362 Agent \u5931\u8D25\uFF08HTTP {status}\uFF09",
  focus_timeout: "\u5207\u6362 Agent \u8D85\u65F6",
  history_http: "\u8BFB\u53D6\u5386\u53F2\u5931\u8D25\uFF08HTTP {status}\uFF09",
  history_timeout: "\u8BFB\u53D6\u5386\u53F2\u8D85\u65F6",
  history_invalid: "\u5386\u53F2\u54CD\u5E94\u683C\u5F0F\u65E0\u6548",
  history_read: "\u65E0\u6CD5\u8BFB\u53D6\u5386\u53F2",
  send_http: "\u53D1\u9001\u5931\u8D25\uFF08HTTP {status}\uFF09",
  send_timeout: "\u53D1\u9001\u6D88\u606F\u8D85\u65F6",
  send_failed: "\u53D1\u9001\u5931\u8D25",
  connect_failed: "\u65E0\u6CD5\u8FDE\u63A5 daemon",
  nearby_permission_denied: "\u672A\u83B7\u5F97\u9644\u8FD1\u8BBE\u5907\u6743\u9650",
};

export const errorMessageBundles: Record<ResolvedLocale, Record<NetworkErrorCode, string>> = {
  en: errorEn,
  "zh-Hans": errorZhHans,
};

/** Parameter map for `{placeholder}` interpolation. `undefined` is allowed for optional values (e.g. HTTP status). */
export type TranslateParams = Record<string, string | number | undefined>;

/** Replace `{name}` placeholders in a template with params; missing values are left as-is. */
export function formatTemplate(
  template: string,
  params?: TranslateParams,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value != null ? String(value) : match;
  });
}

function bundleFor(locale: ResolvedLocale): Record<MessageKey, string> {
  return messageBundles[locale] ?? messageBundles[DEFAULT_LOCALE];
}

function errorBundleFor(locale: ResolvedLocale): Record<NetworkErrorCode, string> {
  return errorMessageBundles[locale] ?? errorMessageBundles[DEFAULT_LOCALE];
}

/** Look up a UI message, falling back to English if the locale bundle is missing the key. */
export function translateUi(
  locale: ResolvedLocale,
  key: MessageKey,
  params?: TranslateParams,
): string {
  const bundle = bundleFor(locale);
  return formatTemplate(bundle[key] ?? messageBundles[DEFAULT_LOCALE][key], params);
}

/** Look up a localized error message for a stable code. */
export function translateError(
  locale: ResolvedLocale,
  code: NetworkErrorCode,
  params?: TranslateParams,
): string {
  const bundle = errorBundleFor(locale);
  return formatTemplate(bundle[code] ?? errorMessageBundles[DEFAULT_LOCALE][code], params);
}
