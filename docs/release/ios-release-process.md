# iOS release process (maintainers)

[简体中文](../zh-CN/release/ios-release-process.md)

This is a maintainer runbook for shipping a new iOS TestFlight build via Xcode Cloud. It is not user-facing; see [Install the iOS TestFlight app](ios-testflight.md) for that.

## Why iOS has its own tag prefix

The daemon and Android releases share `v*` tags and a single combined GitHub Release per tag (`daemon-release.yml` creates it; `android-release.yml` waits for it and uploads into it). iOS deliberately does **not** join that scheme: it uses its own `ios-v*` tag prefix, triggering a separate Xcode Cloud workflow instead of GitHub Actions.

Reusing `v*` for iOS would mean every daemon-only tag also archives and uploads an iOS build for no reason, and — worse — a forgotten `buildNumber` bump on an unrelated tag fails the Xcode Cloud upload outright (App Store Connect rejects a re-used build number for the same app version).

Keeping the three tracks independent costs nothing at runtime: daemon/app compatibility is enforced by the `api_version` the daemon advertises and the mobile client checks (`daemon_outdated` / `app_outdated` in `apps/mobile/src/i18n/errors.ts`), not by aligning marketing version numbers across platforms. There is no need to coordinate `ios-v*` with the daemon's `v*` tags, including at major-version boundaries — that would just reintroduce the same coordination cost this split is meant to avoid.

## Xcode Cloud configuration (App Store Connect)

Configured entirely in App Store Connect, not in this repo:

- **Start Condition:** Tag Changes → Starts With → `ios-v`.
- **Archive - iOS action → Distribution Preparation:** `App Store Connect` (not `TestFlight (Internal Testing Only)` — internal-only never reaches the public external testing group).
- **Post-Actions:** add `TestFlight (External Testing)`, targeting the external group with the public TestFlight link enabled. The first submission to a given external group requires Beta App Review; later builds to the same group with no metadata changes are typically automatic.

## Cutting a release

1. Bump `apps/mobile/app.config.ts`'s `ios.buildNumber`. Nothing does this automatically: `ci_post_clone.sh` runs `expo prebuild` on every Xcode Cloud run, which writes this static value straight into `Info.plist`. An unbumped `buildNumber` is not silently reused — App Store Connect just rejects the upload.
2. Commit that bump (e.g. `release(ios): bump buildNumber to <N>`).
3. Push, then tag and push the tag. **Never move or re-push an existing tag** — Xcode Cloud triggers on tag creation, and a force-moved tag both may not re-trigger and leaves anyone who already fetched it with a stale ref. Always cut a new tag:

   ```sh
   git tag -a ios-v<version>-build<buildNumber> -m "ios-v<version>-build<buildNumber>"
   git push origin ios-v<version>-build<buildNumber>
   ```

   For example, bumping to `buildNumber: "8"` with `version: "0.1.0"` unchanged tags `ios-v0.1.0-build8`. If `version` itself changes, fold that into the tag too (`ios-v0.1.1-build9`).
4. Check the workflow's run history in App Store Connect's Xcode Cloud tab to confirm the build started, and TestFlight for the processed build once it finishes.
