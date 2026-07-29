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
