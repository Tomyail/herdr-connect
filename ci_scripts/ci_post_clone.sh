#!/bin/sh
set -e

corepack enable
corepack prepare pnpm@10.34.5 --activate

pnpm install --frozen-lockfile

cd apps/mobile
bundle install
node scripts/ios-release.mjs prepare
