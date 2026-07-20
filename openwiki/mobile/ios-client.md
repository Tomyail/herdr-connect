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

### Key Screens

- **AgentsScreen** (`AgentsScreen.tsx`) — Lists all agents with status pills and brand icons; shows pairing/revoked/error state when not connected
- **AgentDetail** (`AgentDetail.tsx`) — Shows recent output, focus switcher, text input, and interrupt button with confirmation dialog
- **PairingScreen** (`PairingScreen.tsx`) — Full-screen QR scanner for pairing with the daemon
- **SettingsScreen** (`SettingsScreen.tsx`) — Links to language, appearance, pairing, and diagnostics
- **LanguageScreen** (`LanguageScreen.tsx`) — English/Chinese selection
- **AppearanceScreen** (`AppearanceScreen.tsx`) — Light/dark theme selection

## Connection & Pairing Flow

The app uses `@inthepocket/react-native-service-discovery` for Bonjour browsing and a custom pinned-fetch native module for TLS-pinned HTTPS communication.

### Pinned-Fetch Module

The pinned-fetch module (`/apps/mobile/modules/pinned-fetch/`) is an iOS-only Expo native module that performs HTTPS requests via `URLSession` with a custom delegate. The delegate validates the server certificate's SHA-256 fingerprint against a pinned value during the TLS handshake — no standard CA-chain or hostname validation is performed. See [Secure Pairing & TLS Protocol](../protocol/secure-pairing.md) for the trust model.

Error codes are deliberately limited (`fingerprint_mismatch`, `tls_handshake_failed`, `timeout`, `network_error`, `invalid_url`, `unsupported_platform`) to avoid leaking server state to unauthenticated callers.

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
| `failed` | Network or source error | Error detail, retry |

The `denied` (local network permission) state is handled via discovery errors and shown as a failed state with instructions to enable in Settings.

## Agent List

The `AgentsScreen` displays all agents from `/v1/demo/agents`:

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
- Monospace font with preserved spacing
- Auto-scrolls to bottom on new data
- Manually scrollable to review history

### Focus Switcher

A strip at the top allows quick switching between agents:

- Shows current agent in bold
- Other agents as tappable pills
- Updates immediately on tap (calls `/v1/demo/agents/{id}/focus`)
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
- Sends `POST /v1/demo/agents/{sourceId}/interrupt`
- Uses a dedicated `InterruptPhase` state machine (`idle`, `sending`, `sent`, `failed`) separate from the message send state
- Shows success/failure feedback via localized strings

## Notifications

The app plays a completion chime when an agent finishes:

### DoneSoundProvider

- Preloads audio file on app launch
- Plays when agent transitions to succeeded/failed
- Respects iOS silent mode and ringer switch
- Only plays for agents that were working when the screen was visible

### RecentCompletionsProvider

- Tracks agents that completed in last 30 seconds
- Updates "just completed" badge in agent list
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
- `GET /v1/demo/agents` — Agent list and state
- `GET /v1/demo/agents/{sourceId}/history` — Recent terminal output
- `POST /v1/demo/agents/{sourceId}/focus` — Switch focus to agent
- `POST /v1/demo/agents/{sourceId}/messages` — Send text input
- `POST /v1/demo/agents/{sourceId}/interrupt` — Interrupt running agent

### Error Handling

- **Revoked (401)** — Clears credentials, transitions to `revoked` state
- **Unauthorized (401)** — Clears credentials, transitions to `not_paired` state
- **Fingerprint mismatch** — Transitions to `fingerprint_mismatch` state (credentials retained)
- **Network errors** — Show retry prompt or error state
- **Source offline** — Show warning, serve last known state
- **429 rate limited** — Respects `Retry-After` header

### Polling

The app polls `/v1/demo/agents` every 2 seconds when connected. This ensures the UI stays up-to-date with agent state changes.

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
- **Brand icon detection** — `brand-icons.test.ts`
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
