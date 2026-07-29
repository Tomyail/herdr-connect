#!/bin/sh
set -e

cd "${CI_PRIMARY_REPOSITORY_PATH:-$(git rev-parse --show-toplevel)}"

corepack enable
corepack prepare pnpm@10.34.5 --activate

pnpm install --frozen-lockfile

cd apps/mobile
bundle install
node scripts/ios-release.mjs prepare
