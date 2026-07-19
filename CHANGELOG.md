# Changelog

This file records notable user-facing changes to Herdr Connect. The English version is canonical; a Simplified Chinese translation is available at [`docs/zh-CN/CHANGELOG.md`](docs/zh-CN/CHANGELOG.md).

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

[0.1.0-preview.3]: https://github.com/Tomyail/herdr-connect/compare/v0.1.0-preview.2...v0.1.0-preview.3
