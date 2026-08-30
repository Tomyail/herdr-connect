---
type: release-pipeline
title: Mobile Release Pipeline
description: How iOS TestFlight releases, fixture-driven App Store screenshot generation, and the (currently dormant) Android release workflow work for the Herdr Connect mobile app.
tags: [mobile, ios, android, release, testflight, screenshots, fastlane]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-30T21:43:29.677Z
sources:
  - id: openwiki-source-7e2feff63ac717cadd6c55fa
    resource: repo://.github/workflows/android-release.yml
  - id: openwiki-source-a04d6c803675fbfe778f6010
    resource: repo://apps/mobile/modules/screenshot-launch-options/index.ts
  - id: openwiki-source-9b6b7257d69ddb1a6db124bf
    resource: repo://apps/mobile/modules/screenshot-launch-options/ios/ScreenshotLaunchOptionsModule.swift
  - id: openwiki-source-69ab7d637186dbfa16339249
    resource: repo://apps/mobile/scripts/compose_app_store_screenshots.swift
  - id: openwiki-source-be755051e7015fe6b4486c30
    resource: repo://apps/mobile/scripts/ios-release.mjs
  - id: openwiki-source-0bf167f008fbaba0f95ffc7f
    resource: repo://apps/mobile/scripts/ios-screenshots.mjs
  - id: openwiki-source-499f916017f3cb05929bdb42
    resource: repo://apps/mobile/src/App.tsx
  - id: openwiki-source-41b2fe1ccdd93d7e6e0cbee0
    resource: repo://apps/mobile/src/AppStoreScreenshotScene.tsx
  - id: openwiki-source-8cc220c689fa0d7d37ce0143
    resource: repo://apps/mobile/src/screenshot-fixtures.ts
  - id: openwiki-source-570db0334c73da0ce96799d8
    resource: repo://docs/maintainers/releasing.md
generated: { by: "openwiki/0.4.3", at: "2026-08-30T21:43:29.677Z" }
---

# Mobile Release Pipeline

The mobile app (`apps/mobile`) ships to iOS TestFlight through local Xcode tooling driven by the App Store Connect CLI (`asc`), generates App Store screenshots from **fixture data rather than a live daemon**, and has a GitHub Actions workflow for Android releases whose signing secrets are **not yet configured**, so it is currently manual-dispatch-only and effectively dormant.

There is **no fastlane setup** today: no `fastlane/` directory, Fastfile, or Appfile exists in the repository, and `docs/maintainers/releasing.md` explicitly states that iOS releases use Xcode plus `asc` and do not rely on EAS cloud builds, Ruby, or Fastlane. Fastlane is only mentioned historically in release docs; treat any fastlane reference as superseded.

## Maintainer-facing entrypoints

`docs/maintainers/releasing.md` is the canonical maintainer runbook. For iOS it prescribes:

```sh
cd apps/mobile
pnpm release:ios:prepare
pnpm release:ios:build
pnpm release:ios:upload

# screenshot generation (requires: brew install cameroncooke/axe/axe)
pnpm screenshots            # full pipeline
pnpm screenshots:marketing  # recompose marketing images only
pnpm screenshots:raw        # raw simulator captures only
```

Before a release, maintainers must increment `ios.buildNumber` in `apps/mobile/app.config.ts` and configure the Apple Team ID and App Store Connect API key locally (the `.p8` key must never be committed).

## iOS release: `scripts/ios-release.mjs`

A Node CLI with four subcommands, all of which first run `validateConfig()` — it reads the Expo config as JSON and enforces four invariants before anything else touches Xcode:

- `ios.bundleIdentifier` must be exactly `com.tomyail.herdrconnect`
- `ios.buildNumber` must be a non-empty digit string
- `ios.infoPlist.ITSAppUsesNonExemptEncryption` must be explicitly `false` (export-compliance)
- `ios.infoPlist.NSPhotoLibraryUsageDescription` must be a non-empty string

- **prepare** — runs `expo prebuild --platform ios --no-install` (with `--clean` if `EXPO_PREBUILD_CLEAN` is truthy), then `pod install` (via `bundle exec` locally, plain `pod` when `CI_XCODE_CLOUD=TRUE`), and fails if `ios/HerdrConnect.xcworkspace` is still missing afterwards.
- **build** — requires `APPLE_DEVELOPMENT_TEAM`; archives the `HerdrConnect` scheme (Release configuration) and exports an App Store Connect IPA via `asc xcode archive` / `asc xcode export --method app-store-connect`, passing `-allowProvisioningUpdates` and an optional `DEVELOPMENT_TEAM=` xcodebuild flag. Artifacts land in `apps/mobile/build/ios/` (`HerdrConnect.xcarchive`, `HerdrConnect.ipa`).
- **upload** — uploads the IPA with `asc builds upload --wait`; `IPA_PATH` can override the default path.
- **distribute** — publishes to TestFlight groups. Requires `TESTFLIGHT_CHANGELOG` and a comma-separated `TESTFLIGHT_GROUPS`; uses `ios.buildNumber` (or `TESTFLIGHT_BUILD_NUMBER`) as the build number. `TESTFLIGHT_NOTIFY=1` adds `--notify`, and `TESTFLIGHT_EXTERNAL=1` adds `--submit --confirm` to submit for Beta App Review. This step is what makes the build reach the public external test group (already past Beta App Review; invite link `https://testflight.apple.com/join/ZkRzJ6rm`).

## App Store screenshots

App Store screenshots never connect to a real daemon and never touch the developer's paired credentials. Instead, a Debug-only harness renders the **production UI components** against a frozen in-memory connection snapshot.

### Fixture data: `src/screenshot-fixtures.ts`

Defines three scenes — `agents`, `detail`, `settings` (`ScreenshotSceneName`) — plus stable fake data: a `DiscoveredService` (`MacBook Pro · Herdr`, port 9808), four agents in different interaction states (`working`, `ready_input`, `blocked`), an `AgentsResponse` with `source_online: true`, two `DeviceCredentials` instances (fake fingerprints/tokens), and localized history markdown in English and Simplified Chinese. `createScreenshotConnection()` returns a `ConnectionValue` in the `connected` phase with `streamStatus: "live"` and **all callbacks as no-ops**, so screenshot scenes cannot mutate real credentials.

### Debug-only scene: `src/AppStoreScreenshotScene.tsx`

`App.tsx` computes `screenshotScene` only when `__DEV__` is true — the screenshot route cannot activate in a production bundle. When a scene is active, `App` also pins the theme to light, the i18n language to the launch-argument locale, and a fixed time label (`9:41 AM` / `09:41`).

`AppStoreScreenshotScene` wraps the **real** production components (`AgentsScreenContent`, `AgentDetailBody`, `SettingsScreen`, `SplitLayout`) in a `ConnectionFixtureProvider` seeded with the fixture connection — it is a UI harness, not a duplicate product surface. Wide layouts (iPad) route through the production `SplitLayout`; narrow devices render dedicated detail/settings compositions. The root view carries `accessibilityLabel="app-store-screenshot-ready"`, which the capture script uses as its readiness signal.

### Native launch-argument bridge: `modules/screenshot-launch-options`

An Expo native module (iOS-only) that exposes simulator launch arguments to JavaScript. The Swift `ScreenshotLaunchOptionsModule.get()` reads `ProcessInfo.processInfo.arguments` for `-appStoreScreenshotScene` and `-appStoreScreenshotLocale` and returns them as `{scene, locale}`. Keeping the arguments native means `xcrun simctl launch` can select a scene **without rebuilding the JS bundle** per screenshot. The JS wrapper (`index.ts`) resolves the module only on iOS and swallows all failures, so Expo Go, Android, and production builds load fine without it.

### Capture pipeline: `scripts/ios-screenshots.mjs`

```mermaid
flowchart TD
    A["pnpm screenshots"] --> B["ensureMetro - expo start dev client"]
    B --> C["Boot simulator - iPhone 13 Pro Max or iPad Pro 13-inch M5"]
    C --> D["Build Debug simulator app - asc xcode build, no signing"]
    D --> E["Set simulator locale and reboot"]
    E --> F["simctl launch with scene and locale args"]
    F --> G["Wait for app-store-screenshot-ready via AXe"]
    G --> H["asc screenshots run with wait-then-screenshot plan"]
    H --> I["Raw PNG in build/screenshots/raw/locale/device"]
    I --> J["Compile composer Swift - swiftc"]
    J --> K["SwiftUI marketing composition with device mockup and localized copy"]
    K --> L["asc screenshots validate - APP_IPHONE_65 or APP_IPAD_PRO_3GEN_129"]
```

The end-to-end screenshot pipeline: Metro serves the Debug bundle, two simulators capture fixture scenes, and a local SwiftUI composer produces the marketing frames that `asc` validates against App Store display-type requirements.

Key mechanisms:

- **Devices**: only two simulators are ever used — `iPhone 13 Pro Max` (its 1284×2778 output fits the `APP_IPHONE_65` slot; newer Pro Max devices produce the separate 6.9-inch slot) and `iPad Pro 13-inch (M5)` (`APP_IPAD_PRO_3GEN_129`).
- **Determinism**: before capture, the script overrides the simulator status bar (time `9:41`, 100% charged battery, full Wi-Fi), sets light appearance, and writes `AppleLanguages`/`AppleLocale` defaults followed by a **reboot** so iPadOS status-bar dates follow the screenshot locale rather than the host locale.
- **Readiness detection**: it polls `axe describe-ui` for the `app-store-screenshot-ready` label (or the localized Agents-overview heading), auto-tapping a "Development Server" button if Expo Dev Client shows one, up to 40 attempts.
- **Scene selection**: the app is launched directly by `simctl launch` with `-appStoreScreenshotScene`/`-appStoreScreenshotLocale` plus flags hiding the Expo Dev Menu floating button. Because `asc screenshots capture` would relaunch the app and drop those arguments, the script instead writes an `asc` plan containing only `wait` + `screenshot` steps and runs `asc screenshots run --plan`, leaving the already-launched process alive with the chosen fixture scene.
- **Matrix**: default run is 2 devices × 2 locales (`en-US`, `zh-Hans`) × 3 scenes = 12 raw PNGs; `--device`, `--scene`, `--locale`, `--skip-build`, `--raw-only`, `--compose-only` narrow it. Raw images go to `apps/mobile/build/screenshots/raw/`, marketing images to `apps/mobile/build/screenshots/marketing/` (both git-ignored).

### Marketing composition: `scripts/compose_app_store_screenshots.swift`

A standalone Swift executable (compiled ad hoc with `xcrun swiftc -parse-as-library`, binary cached at `build/screenshots/screenshot-composer`) invoked as `RAW_DIR OUTPUT_DIR LOCALE DEVICE`. It renders each raw scene PNG inside a device mockup (device-specific canvas 1284×2778 / 2064×2752, corner radii, bezels) beneath a localized marketing header (kicker, two-line display title, subtitle) using `ImageRenderer` at scale 1, and writes PNGs atomically. Copy is defined per locale per scene (`en-US` and `zh-Hans` dictionaries). A missing scene PNG is tolerated (so `--scene agents` runs succeed) but an unreadable image or render failure throws. After composition, `ios-screenshots.mjs` runs `asc screenshots validate --device-type APP_IPHONE_65|APP_IPAD_PRO_3GEN_129` so non-conforming images fail the pipeline immediately.

## Android release: `.github/workflows/android-release.yml`

The Android release is **not publicly available yet**; `docs/maintainers/releasing.md` forbids claiming a downloadable APK until a real signed artifact is attached to a GitHub Release and verified. Packaging/signing preparation notes live in `docs/release/android-apk.md`.

The workflow currently:

- Triggers **only via `workflow_dispatch`** with a required `tag` input (an existing GitHub Release tag). Tag-push auto-triggering is deliberately disabled: the release-keystore secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `ANDROID_SIGNING_CERT_SHA256`) are **not yet configured**, so automatic triggers would deterministically fail. The comment at the top of the file records this.
- Validates the tag against `^v[0-9A-Za-z._-]+$` and names artifacts `herdr-connect-<tag>-android(.apk|.aab|-SHA256SUMS)`.
- **Idempotence**: queries the existing GitHub Release assets first and skips the whole build if all three artifacts are already present.
- Decodes the base64 keystore to the runner temp dir (mode 600, verified non-empty, deleted in an `always()` cleanup step) and fails fast if any of the five secrets is missing.
- Builds and verifies via `apps/mobile/scripts/android-release.sh`, renames the checksum manifest to avoid clobbering the daemon release's `SHA256SUMS`, uploads workflow artifacts (14-day retention), **waits up to 30 × 10s for the daemon release workflow to create the GitHub Release**, then `gh release upload --clobber` the APK/AAB/checksums.
- Uses concurrency group `android-release-<tag>` with `cancel-in-progress: false`, and `permissions: contents: write`.

## Related pages

- `/openwiki/development/setup.md` — workspace setup
- `/openwiki/mobile/ios-client.md` — the iOS client itself
