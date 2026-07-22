---
type: Component Documentation
title: iOS Mobile Client
description: React Native iOS app structure, discovery flow, and agent interaction patterns
tags: [mobile, ios, react-native, expo, discovery, bonjour]
resource: /apps/mobile
---

# iOS Mobile Client

The iOS client (`/apps/mobile/`) is a React Native application that pairs with the Herdr Connect daemon via QR code, discovers the daemon via Bonjour, displays agent state, and interacts with agents (view output, switch focus, send text, interrupt). The app is distributed via TestFlight beta and requires a development build due to native service discovery and pinned-fetch modules.

## Architecture

The app adapts to the current window width, not the device type. Below a 768pt breakpoint it uses a phone-style narrow layout; at or above the breakpoint it switches to a three-column split-view layout. Both layouts share the same two top-level destinations (Agents, Settings), and selection state (active destination + selected agent) is lifted into `AppShell` (`App.tsx`) so it survives live resize across the breakpoint.

### Responsive Layout (`layout.ts`, `SplitLayout.tsx`)

The single width threshold is `SPLIT_BREAKPOINT = 768` in `/apps/mobile/src/layout.ts`. The `useIsWideLayout()` hook drives the layout branch in `AppShell`:

- **Narrow mode (< 768pt)** — `ThemedNavigation` uses a bottom tab bar + native-stack detail screens (see below). This is the layout iPhones always see and the layout iPad mini portrait sees by design (744pt is below the breakpoint).
- **Wide mode (≥ 768pt)** — `SplitLayout` (`SplitLayout.tsx`) renders a fixed 220pt sidebar + 340pt list column + flexible detail column. The sidebar replaces the tab bar; the list and detail are side-by-side instead of push-navigated.

The 768pt threshold was chosen so the fixed columns (220 + 340 = 560pt) leave enough remaining width for a usable detail pane at iPad sizes. It is a width check, not a device-type check, so any window resized across it (iPad Split View, Slide Over, Stage Manager) switches layouts live.

#### Narrow Tab Layout

The app uses React Navigation with a tab-based structure:

```
App
 └─ NavigationContainer
      ├─ Tab.Navigator
      │   ├─ Agents Screen (agents list)
      │   └─ Settings Screen (settings tabs)
      └─ Stack.Screen (detail screens)
           ├─ Agent Detail (output, focus, input, interrupt)
           ├─ Pairing (QR scanner)
           ├─ Language (localization)
           └─ Appearance (theme)
```

#### Wide Split Layout

```
AppShell
 └─ SplitLayout
      ├─ Sidebar (220pt) — Agents / Settings destinations
      ├─ List Column (340pt)
      │   ├─ AgentsScreenContent (when destination = Agents)
      │   └─ SettingsCategoryList (when destination = Settings)
      └─ Detail Column (flex)
           ├─ AgentDetailColumn — inline header with focus toggle (Agents)
           └─ SettingsDetailColumn — nested stack for Language/Appearance (Settings)
```

In wide mode, Pairing is presented as a full-screen `<Modal>` overlay above `SplitLayout` (rather than a stack push), so it covers the sidebar and all columns. The Agents detail column has a focus toggle button (expand/contract icon) that collapses the sidebar and list so the transcript/composer fill the full width; tapping again restores three columns. This is per-session state, intentionally not persisted.

#### Shared Navigation Types (`navigation.ts`)

`SidebarDestination` and `sidebarIcons` are defined once in `/apps/mobile/src/navigation.ts` and consumed by both the narrow bottom tab bar and the wide sidebar, keeping icons and labels in sync.

### iPad Native Resolution

The app runs at native iPad resolution (`supportsTablet: true` in `app.config.ts`) rather than iPhone compatibility scaling mode. `requireFullScreen` is intentionally left unset (defaults to false), which allows iPad multitasking (Split View, Slide Over, Stage Manager) and free rotation. The root `orientation: "portrait"` field still drives iPhone portrait lock and Android's portrait lock.

### Key Screens

- **AgentsScreen** (`AgentsScreen.tsx`) — Lists all agents with status pills and brand icons; shows pairing/revoked/error state when not connected. Exports `AgentsScreenContent` for use inside the split-layout list column.
- **AgentDetail** (`AgentDetail.tsx`) — Shows recent output, focus switcher, text input, and interrupt button with confirmation dialog. Exports `AgentDetailBody`, `AgentDetailTitleBlock`, and `AgentDetailRefreshButton` so the wide layout can render the same content with an inline header.
- **PairingScreen** (`PairingScreen.tsx`) — Full-screen QR scanner for pairing with the daemon
- **SettingsScreen** (`Settings.tsx`) — Links to language, appearance, pairing, and diagnostics. Exports `useSettingsCategories` and `SettingsCategoryKey` so both narrow and wide layouts build from the same category definitions.
- **LanguageScreen** (`LanguageScreen.tsx`) — English/Chinese selection
- **AppearanceScreen** (`AppearanceScreen.tsx`) — Light/dark theme selection

## Connection & Pairing Flow

The app uses `@inthepocket/react-native-service-discovery` for Bonjour browsing and a custom pinned-fetch native module for TLS-pinned HTTPS communication.

### Pinned-Fetch Module

The pinned-fetch module (`/apps/mobile/modules/pinned-fetch/`) is an iOS-only Expo native module that performs HTTPS requests via `URLSession` with a custom delegate. The delegate validates the server certificate's SHA-256 fingerprint against a pinned value during the TLS handshake — no standard CA-chain or hostname validation is performed. See [Secure Pairing & TLS Protocol](../protocol/secure-pairing.md) for the trust model.

Error codes are deliberately limited (`fingerprint_mismatch`, `tls_handshake_failed`, `timeout`, `network_error`, `invalid_url`, `unsupported_platform`) to avoid leaking server state to unauthenticated callers.

### Pinned-Stream Module

The pinned-stream module (`/apps/mobile/modules/pinned-stream/`) is a companion iOS-only Expo native module that opens a long-lived HTTPS Server-Sent Events (SSE) stream with the same TLS fingerprint pinning as pinned-fetch. It shares the `PinnedTrustEvaluator` Swift class with pinned-fetch for consistent trust decisions.

The module follows a "native only transports, protocol parsing in JS" design: the Swift layer (`PinnedStreamModule.swift`) accumulates bytes, splits on SSE frame boundaries (`\n\n`), extracts `data:` lines, and emits the raw string to JS. The TypeScript layer (`parseStreamEvent.ts`) validates the JSON shape into `{cursor: string, online: boolean}`. Malformed SSE payloads are silently dropped rather than tearing down the stream.

Key characteristics:

- **Dead-connection detection** — 30-second request timeout (daemon sends a 15-second heartbeat; two missed heartbeats trigger `.timedOut`)
- **One active stream per instance** — A second `startStream` call silently replaces the previous stream
- **Non-iOS platforms** — Throws `unsupported_platform`, no network touched
- **Graceful degradation** — Polling always covers freshness if SSE is unavailable

### Credential Storage

Device credentials are stored in iOS Keychain via `expo-secure-store` (`/apps/mobile/src/credentials.ts`):

- Key: `"herdr-connect.paired-device"`
- Shape: `{fingerprint, deviceId, token, deviceName, pairedAt}`
- Keychain option: `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (device-local, no iCloud sync)

Credentials are cleared in three scenarios: generic 401 (unauthorized), explicit 401 revoked, and manual unpair from Settings.

### Pairing Flow

1. User taps "Pair Device" in Settings → navigates to PairingScreen
2. Camera permission requested; QR scanner activates
3. User scans the QR displayed by `herdr-connect pair` on the host terminal
4. `parsePairingQRPayload` validates QR structure (`v`, `fp`, `hosts`, `port`, `secret`)
5. `pairDaemon` POSTs `{device_name, secret}` to `/v1/pair` via pinned-fetch with the QR fingerprint
6. On success, credentials are saved to Keychain and `connection.refresh()` restarts discovery
7. On failure, a localized error alert is shown

### Connection Context

The `ConnectionProvider` (`connection.tsx`) manages the full connection lifecycle:

```typescript
type ConnectionState =
  | { phase: "discovering" }
  | { phase: "not_found" }
  | { phase: "not_paired" }        // No stored credentials
  | { phase: "revoked" }           // Daemon revoked this device
  | { phase: "fingerprint_mismatch" } // Cert changed since pairing
  | { phase: "daemon_outdated" }   // Daemon API version too old
  | { phase: "app_outdated" }      // Client API version too old (426 from daemon)
  | { phase: "failed"; code; status? }
  | { phase: "connected"; service; data }
```

On mount, the provider checks for stored credentials. If none exist, it transitions directly to `"not_paired"` without starting discovery. Bonjour listeners are always registered so `refresh()` works after first pairing.

### Local Network Permission

iOS requires explicit user permission for local network discovery. The app:

- Detects permission denial via discovery error
- Shows `denied` state with instructions to enable in Settings
- Cannot proceed without permission (Bonjour APIs fail silently)

Permission is requested automatically on first discovery; no custom prompt is shown.

### States

| State | Description | UI |
|-------|-------------|-----|
| `discovering` | Actively browsing for daemon | Loading spinner |
| `connected` | Daemon resolved and responding | Agent list |
| `not_found` | No daemon found (timeout) | Retry prompt |
| `not_paired` | No stored credentials | Pair device prompt |
| `revoked` | Daemon revoked this device | Re-pair prompt |
| `fingerprint_mismatch` | Certificate changed since pairing | Accept new identity prompt |
| `daemon_outdated` | Daemon API version too old | Update daemon prompt |
| `app_outdated` | Client version too old for daemon (426) | Update app prompt |
| `failed` | Network or source error | Error detail, retry |

The `denied` (local network permission) state is handled via discovery errors and shown as a failed state with instructions to enable in Settings.

### Bidirectional API Version Gates

The client and daemon perform mutual version checks to ensure compatibility:

- **Client → Daemon** — Every request includes `X-Herdr-Connect-Client-Version: 1`. The daemon rejects clients below its minimum supported version with `426 Upgrade Required` + `client_outdated`, which the client surfaces as `app_outdated`.
- **Daemon → Client** — Every daemon response includes `api_version` in the JSON body and `X-Herdr-Connect-Api-Version` in headers. The client validates this via `assertDaemonSupported()` after each response parse; if the daemon is too old, the client enters the terminal `daemon_outdated` state.

Both states are terminal — they require a user upgrade action, not a retry.

## Agent List

The `AgentsScreen` displays all agents from `/v1/agents`:

### Row Structure

Each agent row shows:

- **Brand icon** — Visual indicator for agent type (see `AgentBrandIcon.tsx`)
- **Display name** — Agent's display name or workspace/tab path
- **Status pill** — Interaction state (working/blocked/ready_input)
- **Turn outcome** — Succeeded/failed icon if available

### Status Colors

- **Working** — Yellow/orange (actively processing)
- **Ready input** — Green (waiting for text)
- **Blocked** — Red/orange (blocked on external input)
- **Unknown** — Gray (state unclear)

### Sorting

Agents are sorted by:

1. **Completion state** — Just-completed agents first
2. **Timestamp** — Most recent activity first
3. **Display name** — Alphabetical as fallback

The `RecentCompletionsProvider` tracks agents that transitioned to succeeded/failed in the last 30 seconds.

## Agent Detail Screen

Tapping an agent opens the detail screen with three sections:

### Output Section

- Shows last 120 lines of agent terminal output
- Rendered through a lightweight inline markdown formatter (`HistoryMarkdown.tsx` / `history-markdown.ts`) that recognizes a safe subset: headers, fenced code blocks, bold, and inline code
- The formatter preserves line-by-line structure (it is not a CommonMark parser) because tool-call output relies on literal line breaks that paragraph reflow would mangle
- All lines render inside a single selectable `<Text>` tree to preserve cross-line copy-paste
- Auto-scrolls to bottom on new data
- Manually scrollable to review history

### Focus Switcher

A strip at the top allows quick switching between agents:

- Shows current agent in bold
- Other agents as tappable pills
- Updates immediately on tap (calls `/v1/agents/{id}/focus`)
- Preserves scroll position on switch

### Input Section

Text input field with send button:

- Sends up to 4000 characters (enforced by server)
- Disables while source is offline
- Clears after send
- Shows character count

### Interrupt Button

An interrupt bar sits above the input composer, enabled only when the agent's interaction state is `working`. Interrupting a `blocked`, `ready_input`, or `unknown` agent is not meaningful and is disabled.

- Tapping shows a two-step confirmation dialog (destructive style)
- Sends `POST /v1/agents/{sourceId}/interrupt`
- Uses a dedicated `InterruptPhase` state machine (`idle`, `sending`, `sent`, `failed`) separate from the message send state
- Shows success/failure feedback via localized strings

## Notifications

The app provides three notification outputs when an agent finishes a turn (transitions to succeeded/failed), all foreground-only:

### DoneSoundProvider

- Preloads audio file on app launch
- Plays `done.mp3` when agent transitions to succeeded/failed via `expo-audio`
- Respects iOS silent mode and ringer switch
- Only plays for agents that were working when the screen was visible
- Gated by the `doneSoundEnabled` preference (default: on)

### Local Notifications & Haptics

- **OS banner** — `expo-notifications` schedules a foreground banner per completed agent with title (agent display name) and localized "waiting for input" body. No agent output or prompt plaintext is included (per threat model).
- **Haptic** — `expo-haptics` fires a success notification once per completion batch
- Gated by the `localNotificationsEnabled` preference (default: on)
- Notification permission is requested on mount when the setting is on and status is `"undetermined"`, and also when the user toggles the setting on
- Tap on a notification navigates to the corresponding agent's detail screen

### Notification Settings

All stored in MMKV (`"herdr-connect-prefs"` instance):

| Key | Default | Description |
|-----|---------|-------------|
| `doneSoundEnabled` | `true` | Master switch for completion sound chime |
| `notifyWhileViewing` | `true` | Whether to chime/notify for the agent currently open in AgentDetail |
| `localNotificationsEnabled` | `true` | OS banner + haptic notifications when an agent finishes |

### RecentCompletionsProvider

- Tracks agents that completed in last 30 seconds
- Updates "just completed" badge in agent list (independent of sound/notification settings)
- Feeds into sorting logic

## Localization

The app supports English and Chinese via `I18nProvider`:

### Translation Files

- `/apps/mobile/src/i18n/en.ts` — English strings
- `/apps/mobile/src/i18n/zh-Hans.ts` — Simplified Chinese strings

### Usage

Components use the `useI18n()` hook:

```typescript
const { t } = useI18n();
<Text>{t("agent.state.working")}</Text>
```

### Language Detection

App language follows system language:

- English system → English UI
- Chinese system → Chinese UI
- Other systems → English UI (default)

Users can override in Settings.

## Theming

The app supports light and dark themes via `ThemeProvider`:

### Theme Colors

Colors are derived from agent brand icons:

- **Accent color** — Extracted from brand icon palette
- **Background** — White (light), black (dark)
- **Card borders** — Subtle gray
- **Text** — Black (light), white (dark)

### Theme Switching

- **System** — Follows iOS system appearance
- **Light** — Always light mode
- **Dark** — Always dark mode

Dark mode uses slightly muted accent colors for visual comfort.

## Network Layer

All daemon communication uses the pinned-fetch native module for TLS-pinned HTTPS. Authenticated requests add `Authorization: Bearer <token>` via `authPinnedFetch`.

### Endpoints Used

- `POST /v1/pair` — Pair device (no auth, uses one-time secret from QR)
- `GET /v1/agents` — Agent list and state
- `GET /v1/agents/{sourceId}/history` — Recent terminal output
- `POST /v1/agents/{sourceId}/focus` — Switch focus to agent
- `POST /v1/agents/{sourceId}/messages` — Send text input
- `POST /v1/agents/{sourceId}/interrupt` — Interrupt running agent
- `GET /v1/agents/events` — SSE stream of `{cursor, online}` state-change signals

### Error Handling

- **Revoked (401)** — Clears credentials, transitions to `revoked` state
- **Unauthorized (401)** — Clears credentials, transitions to `not_paired` state
- **Fingerprint mismatch** — Transitions to `fingerprint_mismatch` state (credentials retained)
- **Network errors** — Show retry prompt or error state
- **Source offline** — Show warning, serve last known state
- **429 rate limited** — Respects `Retry-After` header

### Polling & SSE Dual-Channel Freshness

The client uses a dual-channel strategy to keep the agent list current:

- **Polling (fallback)** — `setInterval` fires every 3 seconds calling the fetch function. Always runs on foreground as a universal fallback regardless of SSE availability.
- **Pinned SSE stream (iOS optimization)** — The [pinned-stream](#pinned-stream-module) native module opens a long-lived HTTPS SSE connection to `/v1/agents/events`. The daemon emits lightweight `{cursor, online}` signals only on real state changes — never the full agent list. Each SSE event triggers an immediate REST re-fetch of `/v1/agents` for the actual data.

When the SSE stream is live (`streamStatus = "live"`), polling is stopped to save battery. On any SSE error or close, polling resumes immediately (no freshness gap) and reconnection is scheduled with exponential backoff. On non-iOS platforms, the stream module throws `unsupported_platform` and polling covers freshness alone.

## Brand Icons

Brand icons visually distinguish agent types:

### Icon Sources

Icons are generated from SVG paths in `brand-icons.ts`:

- **Claude** — Anthropic brand (orange)
- **GPT** — OpenAI brand (teal)
- **Generic** — Default robot icon (gray)

### Usage

`AgentBrandIcon` component accepts agent name and returns matching icon:

```typescript
<AgentBrandIcon agentName={agent.agentName} size={24} />
```

Icons are tested for color extraction accuracy in `brand-icons.test.ts`.

## Development Build

The app requires an Expo development build due to the native Bonjour module:

### Why Not Expo Go?

Expo Go does not include `@inthepocket/react-native-service-discovery`. The app must be built with the native module included.

### Build Commands

```sh
# Development build (requires iPhone)
pnpm ios:mobile

# Production build (requires EAS config)
pnpm release:ios:prepare
pnpm release:ios:build
```

See [Development Setup](../development/setup.md) for full instructions.

## Testing

Mobile tests cover:

- **Status formatting** — `agent-status.test.ts`
- **Agent contract parsing & version gates** — `agent-contract.test.ts`
- **Brand icon detection** — `brand-icons.test.ts`
- **History markdown parsing** — `history-markdown.test.ts`
- **Done detection** — `notifications/doneDetection.test.ts`
- **SSE stream event parsing** — `modules/pinned-stream/src/parseStreamEvent.test.ts`
- **History scroll logic** — `history-scroll.test.ts`
- **Localization** — `i18n/*.test.ts`
- **Theme** — `theme/*.test.ts`

Run with:

```sh
pnpm test:mobile
```

## Distribution

The app is distributed via TestFlight:

### TestFlight Link

Public beta: `https://testflight.apple.com/join/ZkRzJ6rm`

### Release Process

1. Update version in `apps/mobile/package.json`
2. Run `release:ios:prepare` to update Expo config
3. Run `release:ios:build` to build with EAS
4. Upload to App Store Connect
5. Submit for TestFlight review

See `/docs/release/ios-testflight.md` for troubleshooting.

## Android Support

Android is not currently supported. The Bonjour module has Android equivalents (NSD — Network Service Discovery), but:

- A separate APK build is required
- UI adaptations needed for Android navigation patterns
- Distribution mechanism undecided (Play Store? APK download?)

Future milestone after pairing and E2EE are implemented.

## Troubleshooting

### Discovery Not Working

- Confirm both devices on same Wi-Fi
- Disable VPN temporarily
- Check local network permission in iOS Settings
- Ensure daemon is running: `herdr-connect service status`
- Check for client isolation on guest networks

### App Shows "Source Offline"

- Check Herdr is running: `herdr agent list`
- Verify daemon can reach Herdr CLI
- Check daemon logs: `herdr-connect service logs`

### Input Not Sending

- Verify agent is in `ready_input` state
- Check input is under 4000 characters
- Ensure source is online (not offline)
- Retry after tapping the agent again

For more issues, see `/docs/release/ios-testflight.md`.
