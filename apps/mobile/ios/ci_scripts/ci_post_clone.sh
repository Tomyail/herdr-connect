#!/bin/sh
set -e

cd "${CI_PRIMARY_REPOSITORY_PATH:-$(git rev-parse --show-toplevel)}"

if ! command -v mise >/dev/null 2>&1; then
  brew install mise
fi

cd apps/mobile

export MISE_DISABLE_TOOLS=ruby
mise install

mise exec -- pnpm install --frozen-lockfile
mise exec -- node scripts/ios-release.mjs prepare

# Xcode Cloud archives with CODE_SIGN_IDENTITY=- (ad-hoc) and re-signs itself.
# Xcode 26+ rejects ad-hoc builds of device app targets referencing an
# entitlements file ("has entitlements that require signing with a development
# certificate"), even when the entitlements are empty. Disabling code signing
# for the app target's build configurations restores the old behavior; Xcode
# Cloud's own re-sign step still produces the signed IPA.
#
# Only applied here in CI — the pbxproj on disk stays as prebuild generated it
# for local builds. ponytail: sed on the generated pbxproj; if the prebuild
# template changes and this stops matching, the grep guard fails the build
# loudly instead of silently shipping a broken archive.
PBXPROJ=ios/HerdrConnect.xcodeproj/project.pbxproj
sed -i '' 's/IPHONEOS_DEPLOYMENT_TARGET = 16.4;/IPHONEOS_DEPLOYMENT_TARGET = 16.4;\
				CODE_SIGNING_ALLOWED = NO;/' "$PBXPROJ"

if ! grep -q "CODE_SIGNING_ALLOWED = NO" "$PBXPROJ"; then
  echo "[ci_post_clone] ERROR: failed to inject CODE_SIGNING_ALLOWED=NO into pbxproj" >&2
  exit 1
fi
echo "[ci_post_clone] disabled app-target code signing for the Xcode Cloud archive phase"
