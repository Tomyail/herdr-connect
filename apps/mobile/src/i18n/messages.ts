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
  "agents.status.notPaired": "Not paired",
  "agents.status.fingerprintMismatch": "Identity mismatch",
  "agents.status.revoked": "Device revoked",
  "agents.status.daemonOutdated": "Daemon update required",
  "agents.status.appOutdated": "App update required",
  "agents.status.connected": "Connected",
  "connection.live": "Live",
  "connection.polling": "Polling",
  "agents.detail.discovering": "Make sure your iPhone and daemon are on the same local network.",
  "agents.detail.notFound": "Check that the daemon is running and broadcasting the service.",
  "agents.detail.notPaired": "Go to Settings and pair this device with a daemon to get started.",
  "agents.detail.fingerprintMismatch": "The daemon certificate has changed. Go to Settings to pair again.",
  "agents.detail.revoked": "This device has been revoked from the daemon. Go to Settings to pair again.",
  "agents.detail.daemonOutdated": "This daemon uses an older API version. Update Herdr Connect on your Mac, then try again.",
  "agents.detail.appOutdated": "This app is too old for the daemon. Update Herdr Connect on your iPhone, then try again.",
  "agents.summary.sourceOnline": "source online",
  "agents.summary.sourceOffline": "source offline",
  "agents.summary.count": "{count}",
  "agents.empty": "No agents",
  "agents.placeholder.title": "Waiting for local connection",
  "agents.placeholder.text":
    "Once a service is discovered, a daemon is selected automatically and the latest agent state is loaded.",
  "agents.row.unnamed": "Unnamed agent",
  "agents.row.switchA11y": "Switch to {title} {tab}",
  "agents.row.justCompleted": "Just finished",
  "agents.focus.switching": "Switching\u2026",
  "agents.focus.switched": "Switched",
  "agents.focus.failed": "Switch failed",

  "interaction.working": "Working",
  "interaction.blocked": "Blocked",
  "interaction.ready_input": "Awaiting input",
  "interaction.succeeded": "Finished",
  "interaction.failed": "Failed",
  "interaction.cancelled": "Cancelled",
  "interaction.idle": "Idle",

  "detail.empty.title": "No agent selected",
  "detail.empty.text": "Select an agent from the list to view its history.",
  "detail.focusLayoutA11y": "Focus the detail column and hide the sidebar and list",
  "detail.expandLayoutA11y": "Show the sidebar and list again",
  "detail.historyTitle": "History",
  "detail.historyMeta.truncated": "Recent excerpt",
  "detail.historyMeta.recent": "Recent",
  "detail.loadingHistory": "Loading recent history",
  "detail.emptyHistory": "No history to display yet.",
  "detail.newContent": "New content \u2193",
  "detail.refreshA11y": "Refresh history",
  "detail.inputA11y": "Message to send to the agent",
  "detail.inputPlaceholder": "Type a message to send to the desktop\u2026",
  "detail.sendA11y": "Send message",
  "detail.send": "Send",
  "detail.sentToDesktop": "Sent to desktop",
  "detail.voice.startA11y": "Start voice input",
  "detail.voice.stopA11y": "Stop voice input",
  "detail.voice.continuousModeA11y": "Continuous voice mode",
  "detail.voice.continuousModeEnabled": "Continuous conversation on: Auto-send after you speak, then listen again after the Agent replies.",
  "detail.voice.continuousModeDisabled": "Continuous conversation off.",
  "detail.voice.listening": "Listening…",
  "detail.voice.permissionTitle": "Voice input needs permission",
  "detail.voice.permissionMessage": "Herdr Connect needs microphone and speech recognition access to turn your voice into text.",
  "detail.voice.permissionGrant": "Grant access",
  "detail.voice.error": "Voice input failed",
  "detail.interrupt": "Stop",
  "detail.interruptA11y": "Stop the running agent",
  "detail.interruptDisabledA11y": "Agent is not running",
  "detail.interruptConfirm.title": "Stop agent?",
  "detail.interruptConfirm.body": "This sends an interrupt signal to the desktop and stops the current turn.",
  "detail.interruptConfirm.confirm": "Stop",
  "detail.interruptConfirm.cancel": "Cancel",
  "detail.interruptSent": "Stop signal sent",
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
  "settings.row.project": "Project",
  "settings.row.language": "Language",
  "settings.row.doneSound": "Completion sound",
  "settings.row.sentSound": "Send confirmation sound",
  "settings.row.notifyWhileViewing": "Also notify while viewing",
  "settings.row.localNotifications": "Show OS notification",
  "settings.row.autoSendVoice": "Use continuous voice by default",
  "settings.row.silenceThreshold": "Silence threshold",
  "settings.value.languageSystem": "System default",

  "notifications.waitingForInput": "Waiting for input",

  "language.title": "Language",
  "language.option.system": "System default",
  "language.option.zhHans": "\u7B80\u4F53\u4E2D\u6587",
  "language.option.en": "English",

  "settings.row.appearance": "Appearance",
  "appearance.title": "Appearance",
  "appearance.option.system": "System default",
  "appearance.option.light": "Light",
  "appearance.option.dark": "Dark",

  "settings.row.voiceLanguage": "Voice recognition language",
  "settings.value.voiceLanguageSystem": "Follow system",
  "voice.language.title": "Voice recognition language",
  "voice.language.system": "Follow system",
  "voice.countdownA11y": "Will send in {n} seconds",
  "voice.silenceThreshold.title": "Silence threshold",
  "settings.value.silenceThreshold": "{n}s",

  "pairing.title": "Pair device",
  "pairing.deviceNameLabel": "Device name",
  "pairing.deviceNamePlaceholder": "My iPhone",
  "pairing.scanPrompt": "Point your camera at the QR code shown in the terminal",
  "pairing.pairing": "Pairing…",
  "pairing.success": "Paired successfully",
  "pairing.failed": "Pairing failed",
  "pairing.cameraPermissionTitle": "Camera access needed",
  "pairing.cameraPermissionMessage": "Herdr Connect needs camera access to scan the pairing QR code",
  "pairing.grantCamera": "Grant access",

  "settings.row.fingerprint": "Fingerprint",
  "settings.row.deviceName": "Paired as",
  "settings.value.notPaired": "Not paired",
  "settings.row.pairDevice": "Pair new device",
  "settings.row.unpairDevice": "Unpair device",

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
  "agents.status.notPaired": "\u672A\u914D\u5BF9",
  "agents.status.fingerprintMismatch": "\u8EAB\u4EFD\u4E0D\u5339\u914D",
  "agents.status.revoked": "\u8BBE\u5907\u5DF2\u64A4\u9500",
  "agents.status.daemonOutdated": "需要更新 daemon",
  "agents.status.appOutdated": "需要更新 App",
  "agents.status.connected": "\u5DF2\u8FDE\u63A5",
  "connection.live": "\u5B9E\u65F6",
  "connection.polling": "\u8F6E\u8BE2\u4E2D",
  "agents.detail.discovering": "\u8BF7\u786E\u4FDD iPhone \u4E0E daemon \u4F4D\u4E8E\u540C\u4E00\u5C40\u57DF\u7F51",
  "agents.detail.notFound": "\u68C0\u67E5 daemon \u662F\u5426\u5DF2\u542F\u52A8\u5E76\u5E7F\u64AD\u670D\u52A1",
  "agents.detail.notPaired": "\u524D\u5F80\u8BBE\u7F6E\u914D\u5BF9\u8BBE\u5907\u4EE5\u5F00\u59CB\u4F7F\u7528",
  "agents.detail.fingerprintMismatch": "daemon \u8BC1\u4E66\u5DF2\u53D8\u66F4\u3002\u8BF7\u524D\u5F80\u8BBE\u7F6E\u91CD\u65B0\u914D\u5BF9\u3002",
  "agents.detail.revoked": "\u6B64\u8BBE\u5907\u5DF2\u88AB daemon \u64A4\u9500\u3002\u8BF7\u524D\u5F80\u8BBE\u7F6E\u91CD\u65B0\u914D\u5BF9\u3002",
  "agents.detail.daemonOutdated": "当前 daemon 使用的 API 版本过旧。请更新 Mac 上的 Herdr Connect 后重试。",
  "agents.detail.appOutdated": "当前 App 对这个 daemon 来说过旧。请更新 iPhone 上的 Herdr Connect 后重试。",
  "agents.summary.sourceOnline": "\u6765\u6E90\u5728\u7EBF",
  "agents.summary.sourceOffline": "\u6765\u6E90\u79BB\u7EBF",
  "agents.summary.count": "{count} \u4E2A",
  "agents.empty": "\u5F53\u524D\u6CA1\u6709 Agent",
  "agents.placeholder.title": "\u7B49\u5F85\u672C\u5730\u8FDE\u63A5",
  "agents.placeholder.text":
    "\u53D1\u73B0\u670D\u52A1\u540E\u4F1A\u81EA\u52A8\u9009\u62E9\u4E00\u4E2A daemon\uFF0C\u5E76\u8BFB\u53D6\u6700\u65B0\u7684 Agent \u72B6\u6001\u3002",
  "agents.row.unnamed": "\u672A\u547D\u540D Agent",
  "agents.row.switchA11y": "\u5207\u6362\u5230 {title} {tab}",
  "agents.row.justCompleted": "\u521A\u521A\u5B8C\u6210",
  "agents.focus.switching": "\u5207\u6362\u4E2D\u2026",
  "agents.focus.switched": "\u5DF2\u5207\u6362",
  "agents.focus.failed": "\u5207\u6362\u5931\u8D25",

  "interaction.working": "\u5DE5\u4F5C\u4E2D",
  "interaction.blocked": "\u5DF2\u963B\u585E",
  "interaction.ready_input": "\u7B49\u5F85\u8F93\u5165",
  "interaction.succeeded": "\u5DF2\u5B8C\u6210",
  "interaction.failed": "\u8FD0\u884C\u5931\u8D25",
  "interaction.cancelled": "\u5DF2\u53D6\u6D88",
  "interaction.idle": "\u7A7A\u95F2",

  "detail.empty.title": "\u672A\u9009\u62E9 Agent",
  "detail.empty.text": "\u4ECE\u5217\u8868\u4E2D\u9009\u62E9\u4E00\u4E2A Agent \u4EE5\u67E5\u770B\u5176\u5386\u53F2\u3002",
  "detail.focusLayoutA11y": "\u805A\u7126\u8BE6\u60C5\u5217\uFF0C\u9690\u85CF\u4FA7\u8FB9\u680F\u4E0E\u5217\u8868",
  "detail.expandLayoutA11y": "\u91CD\u65B0\u663E\u793A\u4FA7\u8FB9\u680F\u4E0E\u5217\u8868",
  "detail.historyTitle": "\u5386\u53F2\u6D88\u606F",
  "detail.historyMeta.truncated": "\u8FD1\u671F\u622A\u9762",
  "detail.historyMeta.recent": "\u8FD1\u671F\u8BB0\u5F55",
  "detail.loadingHistory": "\u6B63\u5728\u8BFB\u53D6\u8FD1\u671F\u8BB0\u5F55",
  "detail.emptyHistory": "\u5F53\u524D\u6CA1\u6709\u53EF\u663E\u793A\u7684\u5386\u53F2\u8BB0\u5F55\u3002",
  "detail.newContent": "\u6709\u65B0\u5185\u5BB9 \u2193",
  "detail.refreshA11y": "\u5237\u65B0\u5386\u53F2",
  "detail.inputA11y": "\u53D1\u9001\u7ED9 Agent \u7684\u6D88\u606F",
  "detail.inputPlaceholder": "\u8F93\u5165\u5185\u5BB9\u53D1\u9001\u5230\u684C\u9762\u7AEF\u2026",
  "detail.sendA11y": "\u53D1\u9001\u6D88\u606F",
  "detail.send": "\u53D1\u9001",
  "detail.sentToDesktop": "\u5DF2\u53D1\u9001\u5230\u684C\u9762\u7AEF",
  "detail.voice.startA11y": "\u5F00\u59CB\u8BED\u97F3\u8F93\u5165",
  "detail.voice.stopA11y": "\u505C\u6B62\u8BED\u97F3\u8F93\u5165",
  "detail.voice.continuousModeA11y": "\u8FDE\u7EED\u5BF9\u8BDD\u6A21\u5F0F",
  "detail.voice.continuousModeEnabled": "\u5DF2\u5F00\u542F\u8FDE\u7EED\u5BF9\u8BDD\uFF1A\u8BF4\u5B8C\u81EA\u52A8\u53D1\u9001\uFF0CAgent \u56DE\u590D\u540E\u81EA\u52A8\u7EE7\u7EED\u5F55\u97F3",
  "detail.voice.continuousModeDisabled": "\u5DF2\u5173\u95ED\u8FDE\u7EED\u5BF9\u8BDD",
  "detail.voice.listening": "\u6B63\u5728\u8BC6\u522B…",
  "detail.voice.permissionTitle": "\u8BED\u97F3\u8F93\u5165\u9700\u8981\u6743\u9650",
  "detail.voice.permissionMessage": "Herdr Connect \u9700\u8981\u9EA6\u514B\u98CE\u4E0E\u8BED\u97F3\u8BC6\u522B\u6743\u9650\u624D\u80FD\u5C06\u4F60\u7684\u8BED\u97F3\u8F6C\u4E3A\u6587\u5B57\u3002",
  "detail.voice.permissionGrant": "\u6388\u4E88\u6743\u9650",
  "detail.voice.error": "\u8BED\u97F3\u8F93\u5165\u5931\u8D25",
  "detail.interrupt": "\u53EB\u505C",
  "detail.interruptA11y": "\u53EB\u505C\u5F53\u524D\u8FD0\u884C\u4E2D\u7684 Agent",
  "detail.interruptDisabledA11y": "Agent \u672A\u5728\u8FD0\u884C",
  "detail.interruptConfirm.title": "\u786E\u8BA4\u53EB\u505C\uFF1F",
  "detail.interruptConfirm.body": "\u5C06\u5411\u684C\u9762\u7AEF\u53D1\u9001\u4E2D\u65AD\u4FE1\u53F7\uFF0C\u7EC8\u6B62\u5F53\u524D\u8F6E\u6B21\u3002",
  "detail.interruptConfirm.confirm": "\u53EB\u505C",
  "detail.interruptConfirm.cancel": "\u53D6\u6D88",
  "detail.interruptSent": "\u5DF2\u53D1\u9001\u53EB\u505C\u4FE1\u53F7",
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
  "settings.row.project": "\u9879\u76EE\u4E3B\u9875",
  "settings.row.language": "\u8BED\u8A00",
  "settings.row.doneSound": "\u5B8C\u6210\u63D0\u793A\u97F3",
  "settings.row.sentSound": "\u53D1\u9001\u63D0\u793A\u97F3",
  "settings.row.notifyWhileViewing": "\u67E5\u770B\u65F6\u4E5F\u63D0\u793A",
  "settings.row.localNotifications": "\u663E\u793A\u7CFB\u7EDF\u901A\u77E5",
  "settings.row.autoSendVoice": "\u9ED8\u8BA4\u4F7F\u7528\u8FDE\u7EED\u5BF9\u8BDD",
  "settings.row.silenceThreshold": "\u9759\u97F3\u9608\u503C",
  "settings.value.languageSystem": "\u8DDF\u968F\u7CFB\u7EDF",

  "notifications.waitingForInput": "\u7B49\u5F85\u8F93\u5165",

  "language.title": "\u8BED\u8A00",
  "language.option.system": "\u8DDF\u968F\u7CFB\u7EDF",
  "language.option.zhHans": "\u7B80\u4F53\u4E2D\u6587",
  "language.option.en": "English",

  "settings.row.appearance": "\u5916\u89C2",
  "appearance.title": "\u5916\u89C2",
  "appearance.option.system": "\u8DDF\u968F\u7CFB\u7EDF",
  "appearance.option.light": "\u6D45\u8272",
  "appearance.option.dark": "\u6DF1\u8272",

  "settings.row.voiceLanguage": "\u8BED\u97F3\u8BC6\u522B\u8BED\u8A00",
  "settings.value.voiceLanguageSystem": "\u8DDF\u968F\u7CFB\u7EDF",
  "voice.language.title": "\u8BED\u97F3\u8BC6\u522B\u8BED\u8A00",
  "voice.language.system": "\u8DDF\u968F\u7CFB\u7EDF",
  "voice.countdownA11y": "{n} 秒后自动发送",
  "voice.silenceThreshold.title": "\u9759\u97F3\u9608\u503C",
  "settings.value.silenceThreshold": "{n}秒",

  "pairing.title": "\u914D\u5BF9\u8BBE\u5907",
  "pairing.deviceNameLabel": "\u8BBE\u5907\u540D\u79F0",
  "pairing.deviceNamePlaceholder": "\u6211\u7684 iPhone",
  "pairing.scanPrompt": "\u5C06\u76F8\u673A\u5BF9\u51C6\u7EC8\u7AEF\u4E2D\u663E\u793A\u7684\u4E8C\u7EF4\u7801",
  "pairing.pairing": "\u914D\u5BF9\u4E2D\u2026",
  "pairing.success": "\u914D\u5BF9\u6210\u529F",
  "pairing.failed": "\u914D\u5BF9\u5931\u8D25",
  "pairing.cameraPermissionTitle": "\u9700\u8981\u76F8\u673A\u6743\u9650",
  "pairing.cameraPermissionMessage": "Herdr Connect \u9700\u8981\u76F8\u673A\u6743\u9650\u6765\u626B\u63CF\u914D\u5BF9\u4E8C\u7EF4\u7801",
  "pairing.grantCamera": "\u6388\u4E88\u6743\u9650",

  "settings.row.fingerprint": "\u8BC1\u4E66\u6307\u7EB9",
  "settings.row.deviceName": "\u5DF2\u914D\u5BF9\u4E3A",
  "settings.value.notPaired": "\u672A\u914D\u5BF9",
  "settings.row.pairDevice": "\u914D\u5BF9\u65B0\u8BBE\u5907",
  "settings.row.unpairDevice": "\u89E3\u9664\u914D\u5BF9",

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
  daemon_tls: "TLS handshake with daemon failed",
  response_invalid: "Invalid daemon response format",
  response_missing: "Daemon response is missing required fields",
  agent_invalid: "Invalid agent data format",
  agent_missing: "Agent is missing required fields",
  focus_http: "Failed to switch agent (HTTP {status})",
  focus_timeout: "Timed out switching agent",
  focus_tls: "TLS handshake failed while switching agent",
  history_http: "Failed to read history (HTTP {status})",
  history_timeout: "Timed out reading history",
  history_tls: "TLS handshake failed while reading history",
  history_invalid: "Invalid history response format",
  history_read: "Unable to read history",
  send_http: "Failed to send (HTTP {status})",
  send_timeout: "Timed out sending message",
  send_tls: "TLS handshake failed while sending message",
  send_failed: "Failed to send",
  interrupt_http: "Failed to stop agent (HTTP {status})",
  interrupt_timeout: "Timed out stopping agent",
  interrupt_tls: "TLS handshake failed while stopping agent",
  interrupt_failed: "Failed to stop agent",
  discovery_search_failed: "Bonjour search failed (code {status})",
  discovery_resolve_failed: "Bonjour service resolution failed (code {status})",
  connect_failed: "Unable to connect to daemon",
  nearby_permission_denied: "Nearby devices permission not granted",
  fingerprint_mismatch: "Daemon certificate fingerprint does not match — the daemon identity may have changed",
  unauthorized: "Device is not authorized — pair again to obtain a new token",
  revoked: "This device has been revoked — pair again to obtain a new token",
  pairing_failed: "Pairing failed — check the secret and try again",
  pairing_qr_invalid: "Invalid pairing QR code — make sure you are scanning the correct code",
  not_credentials: "No stored device credentials found",
  daemon_outdated: "This daemon API version is too old — update Herdr Connect on your Mac and try again",
  app_outdated: "This app version is no longer supported by the daemon — update Herdr Connect and try again",
};

const errorZhHans: Record<NetworkErrorCode, string> = {
  no_address: "\u670D\u52A1\u6CA1\u6709\u53EF\u7528\u7F51\u7EDC\u5730\u5740",
  daemon_http: "daemon \u8FD4\u56DE HTTP {status}",
  daemon_timeout: "\u8FDE\u63A5 daemon \u8D85\u65F6",
  daemon_tls: "\u4E0E daemon \u7684 TLS \u63E1\u624B\u5931\u8D25",
  response_invalid: "daemon \u54CD\u5E94\u683C\u5F0F\u65E0\u6548",
  response_missing: "daemon \u54CD\u5E94\u7F3A\u5C11\u5FC5\u8981\u5B57\u6BB5",
  agent_invalid: "Agent \u6570\u636E\u683C\u5F0F\u65E0\u6548",
  agent_missing: "Agent \u7F3A\u5C11\u5FC5\u8981\u5B57\u6BB5",
  focus_http: "\u5207\u6362 Agent \u5931\u8D25\uFF08HTTP {status}\uFF09",
  focus_timeout: "\u5207\u6362 Agent \u8D85\u65F6",
  focus_tls: "\u5207\u6362 Agent \u65F6 TLS \u63E1\u624B\u5931\u8D25",
  history_http: "\u8BFB\u53D6\u5386\u53F2\u5931\u8D25\uFF08HTTP {status}\uFF09",
  history_timeout: "\u8BFB\u53D6\u5386\u53F2\u8D85\u65F6",
  history_tls: "\u8BFB\u53D6\u5386\u53F2\u65F6 TLS \u63E1\u624B\u5931\u8D25",
  history_invalid: "\u5386\u53F2\u54CD\u5E94\u683C\u5F0F\u65E0\u6548",
  history_read: "\u65E0\u6CD5\u8BFB\u53D6\u5386\u53F2",
  send_http: "\u53D1\u9001\u5931\u8D25\uFF08HTTP {status}\uFF09",
  send_timeout: "\u53D1\u9001\u6D88\u606F\u8D85\u65F6",
  send_tls: "\u53D1\u9001\u6D88\u606F\u65F6 TLS \u63E1\u624B\u5931\u8D25",
  send_failed: "\u53D1\u9001\u5931\u8D25",
  interrupt_http: "\u53EB\u505C\u5931\u8D25\uFF08HTTP {status}\uFF09",
  interrupt_timeout: "\u53EB\u505C\u8D85\u65F6",
  interrupt_tls: "\u53EB\u505C\u65F6 TLS \u63E1\u624B\u5931\u8D25",
  interrupt_failed: "\u53EB\u505C\u5931\u8D25",
  discovery_search_failed: "Bonjour \u641C\u7D22\u5931\u8D25\uFF08\u9519\u8BEF\u7801 {status}\uFF09",
  discovery_resolve_failed: "Bonjour \u670D\u52A1\u89E3\u6790\u5931\u8D25\uFF08\u9519\u8BEF\u7801 {status}\uFF09",
  connect_failed: "\u65E0\u6CD5\u8FDE\u63A5 daemon",
  nearby_permission_denied: "\u672A\u83B7\u5F97\u9644\u8FD1\u8BBE\u5907\u6743\u9650",
  fingerprint_mismatch: "daemon \u8BC1\u4E66\u6307\u7EB9\u4E0D\u5339\u914D\u2014\u2014daemon \u8EAB\u4EFD\u53EF\u80FD\u5DF2\u53D8\u66F4",
  unauthorized: "\u8BBE\u5907\u672A\u6388\u6743\u2014\u2014\u8BF7\u91CD\u65B0\u914D\u5BF9\u4EE5\u83B7\u53D6\u65B0\u4EE4\u724C",
  revoked: "\u6B64\u8BBE\u5907\u5DF2\u88AB\u64A4\u9500\u2014\u2014\u8BF7\u91CD\u65B0\u914D\u5BF9\u4EE5\u83B7\u53D6\u65B0\u4EE4\u724C",
  pairing_failed: "\u914D\u5BF9\u5931\u8D25\u2014\u2014\u8BF7\u68C0\u67E5\u5BC6\u94A5\u540E\u91CD\u8BD5",
  pairing_qr_invalid: "\u914D\u5BF9\u4E8C\u7EF4\u7801\u65E0\u6548\u2014\u2014\u8BF7\u786E\u8BA4\u626B\u63CF\u7684\u662F\u6B63\u786E\u7684\u4E8C\u7EF4\u7801",
  not_credentials: "\u672A\u627E\u5230\u5DF2\u5B58\u50A8\u7684\u8BBE\u5907\u51ED\u636E",
  daemon_outdated: "daemon API 版本过旧——请更新 Mac 上的 Herdr Connect 后重试",
  app_outdated: "此 App 版本已不受 daemon 支持——请更新 Herdr Connect 后重试",
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
