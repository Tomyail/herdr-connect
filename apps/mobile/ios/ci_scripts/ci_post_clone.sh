#!/bin/sh
set -e

cd "${CI_PRIMARY_REPOSITORY_PATH:-$(git rev-parse --show-toplevel)}"

if ! command -v mise >/dev/null 2>&1; then
  brew install mise
fi

cd apps/mobile

mise install

mise exec -- pnpm install --frozen-lockfile
mise exec -- bundle install
mise exec -- node scripts/ios-release.mjs prepare
