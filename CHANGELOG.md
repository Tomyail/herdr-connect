# Changelog

This file records notable user-facing changes to Herdr Connect. The English version is canonical; a Simplified Chinese translation is available at [`docs/zh-CN/CHANGELOG.md`](docs/zh-CN/CHANGELOG.md).

## [0.1.0-preview.5] - 2026-07-23

### Added

- Added native iPad support: the app now runs at full iPad resolution instead of a scaled-up iPhone layout, and rotates freely.
- Added a wide-screen split-view layout: a sidebar plus list-and-detail columns for both Agents and Settings, so you can browse a list and read its detail side by side instead of pushing full-screen. Live-resizing the window (Split View, Slide Over, Stage Manager) switches smoothly between this and the phone-style layout.
- Added a focus toggle on the wide Agents view to collapse the sidebar and list and give the transcript the full window width.
- Added on-device voice input: tap the mic next to Send to dictate directly into the message, with live streaming transcription and a real-time waveform driven by your actual voice level — the system keyboard never opens, so your conversation history stays visible the whole time.
- Added a hands-free "continuous voice" mode: after you stop talking, a visible countdown auto-sends what you said (speak again to cancel it), the mic goes quiet while the agent works, and starts listening again automatically once the agent is ready for your next message — tap the loop icon to turn it on, tap again anytime to stop.
- Added a voice recognition language setting (defaults to your device's system language, overridable in Settings).
- Added a silence-duration setting to tune how long the app waits before the continuous-mode countdown starts.
- Added a send confirmation sound.

### Fixed

- Fixed the completion chime going silent after using voice input — voice recognition was leaving the audio session in a state that blocked playback.

### Changed

- The Send button now doubles as the interrupt control while an agent turn is running, freeing up space previously used by a separate interrupt bar.

### Release tooling

- Uploaded iOS TestFlight build `0.1.0 (5)` to App Store Connect and distributed it to testers.

## [0.1.0-preview.4] - 2026-07-20

### Added

- Added a secure pairing flow: scan the daemon's QR code with the camera, enter a device name, and the app establishes mutual trust via TLS fingerprint pinning.
- Added TLS fingerprint pinning for all HTTPS traffic to the LAN daemon, using a local Expo module (`pinned-fetch`) that verifies the daemon's self-signed certificate fingerprint in constant time.
- Added an interrupt button in the agent detail view to stop a running agent turn from the phone, with a confirmation dialog before sending the interrupt.
- Added real-time agent status updates via Server-Sent Events (SSE), with a "Live" / "Polling" indicator in the agents list.
- Added foreground local notifications (with haptic feedback) when an agent is waiting for input, so you don't miss the agent's question even when the app is in the foreground.
- Added inline markdown rendering in agent history (bold, inline code, headers), preserving the line structure of terminal tool output.
- Added device revocation handling: when the daemon revokes a paired device, the app shows a clear "Device revoked" message and clears local credentials so re-pairing starts from a clean state.

### Fixed

- Improved Bonjour discovery reliability so the daemon is found more consistently on the local network.
- Fixed a bug where notification permission was never requested unless the user toggled the notification setting off and on; permission is now requested on app mount when the setting is already enabled.
- Stripped TUI frame borders, prompts, and status lines from agent history so mobile shows clean agent content instead of terminal scaffolding.

### Changed

- The demo API has graduated to `/v1/agents` with bidirectional version checks; outdated daemons or clients now receive a clear upgrade prompt instead of mysterious failures.

### Release tooling

- Uploaded iOS TestFlight build `0.1.0 (4)` to App Store Connect and distributed it to testers.
- Added Developer ID signing, notarization, and stapling to the macOS daemon release build.

## [0.1.0-preview.3] - 2026-07-19

### Added

- Added English and Simplified Chinese localization throughout the mobile app.
- Added light and dark appearance modes, a Settings tab, and slide-over agent details.
- Added agent brand icons, clearer status presentation, and a persistent agent switcher in the detail view.
- Added a completion chime when an agent finishes.

### Fixed

- Preserved history scroll position while updates arrive and avoided unnecessary history refreshes when content is unchanged.
- Fixed completion detection so the completion chime fires reliably.
- Corrected settings row interaction styling.

### Release tooling

- Uploaded iOS TestFlight build `0.1.0 (3)` to App Store Connect; tester distribution remains pending.
- Passed App Store Connect API credentials to Xcode during IPA export so automatic signing can refresh the provisioning profile.

[0.1.0-preview.5]: https://github.com/Tomyail/herdr-connect/compare/v0.1.0-preview.4...v0.1.0-preview.5
[0.1.0-preview.4]: https://github.com/Tomyail/herdr-connect/compare/v0.1.0-preview.3...v0.1.0-preview.4
[0.1.0-preview.3]: https://github.com/Tomyail/herdr-connect/compare/v0.1.0-preview.2...v0.1.0-preview.3
