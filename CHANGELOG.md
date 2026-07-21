# Changelog

This file records notable user-facing changes to Herdr Connect. The English version is canonical; a Simplified Chinese translation is available at [`docs/zh-CN/CHANGELOG.md`](docs/zh-CN/CHANGELOG.md).

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

- Uploaded iOS TestFlight build `0.1.0 (4)` to App Store Connect.

[0.1.0-preview.4]: https://github.com/Tomyail/herdr-connect/compare/v0.1.0-preview.3...v0.1.0-preview.4
[0.1.0-preview.3]: https://github.com/Tomyail/herdr-connect/compare/v0.1.0-preview.2...v0.1.0-preview.3
