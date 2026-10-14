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
- **Post-Actions:** none are configured today — the workflow exposes only the `Archive - iOS` action (verified 2026-10-14: `asc xcode-cloud workflows list --app <APP_ID>` returns a single `ARCHIVE` action and no `postActions`). An upload therefore stops at `READY_FOR_BETA_SUBMISSION` for external testers, so each build must be submitted manually — see step 4 under "Cutting a release". Adding a `TestFlight (External Testing)` post-action would remove that manual step; the first submission to a given external group requires Beta App Review, and later builds to the same group with no metadata changes are typically automatic.

## iOS 27 scene lifecycle

Apps built with the iOS 27 SDK must adopt the UIScene lifecycle; the legacy Expo SDK 56 AppDelegate-only template can trap at launch before application startup. `apps/mobile/plugins/withIosSceneLifecycle.cjs` adds the scene manifest and generates a SceneDelegate in AppDelegate.swift during prebuild, moving window creation into the scene and forwarding linking and lifecycle events to Expo. Once Expo officially supplies equivalent scene support, remove this plugin and its registration in app.config.ts after verifying startup and linking on iOS 27.

## Cutting a release

1. Xcode Cloud assigns the build number itself: the uploaded `CFBundleVersion` is the workflow's build run number, not `apps/mobile/app.config.ts`'s `ios.buildNumber`. Verified on the 2026-10-13 release — run #114 was uploaded as build `114` while `ios.buildNumber` said `101`. **Do not bump `ios.buildNumber` to cut a release**: it has no effect on the upload, and App Store Connect does not reject an upload because that value is stale. It still feeds `expo prebuild`'s `Info.plist` and the local `release:ios:upload` path, so keep it numeric.
2. Tag and push the tag. Pick any unused number for the tag; it only needs to be unique, not equal to the build number Xcode Cloud will assign. **Never move or re-push an existing tag** — Xcode Cloud triggers on tag creation, and a force-moved tag both may not re-trigger and leaves anyone who already fetched it with a stale ref:

   ```sh
   git tag -a ios-v<version>-build<N> -m "ios-v<version>-build<N>"
   git push origin ios-v<version>-build<N>
   ```

   For example, with `version: "0.1.0"` unchanged, tag `ios-v0.1.0-build102`. If `version` itself changes, fold that into the tag too (`ios-v0.1.1-build103`).
3. Watch the run without opening a browser:

   ```sh
   asc xcode-cloud build-runs list --workflow-id <WORKFLOW_ID>   # find the id with: asc xcode-cloud workflows list --app <APP_ID>
   asc xcode-cloud status --run-id <RUN_ID>
   ```

4. **Submit the build to the external test group manually.** The workflow only has the `Archive - iOS` action, so a finished build reaches App Store Connect with `internalBuildState: READY_FOR_BETA_TESTING` and `externalBuildState: READY_FOR_BETA_SUBMISSION` — external testers (the public TestFlight link) cannot install it until it is submitted:

   ```sh
   asc builds list --app <APP_ID>                                    # newest build id, processingState VALID
   asc testflight review submit --build-id <BUILD_ID> --confirm
   ```

   Beta App Review then runs (typically automatic when metadata is unchanged) and `externalBuildState` moves to `BETA_APPROVED`.
