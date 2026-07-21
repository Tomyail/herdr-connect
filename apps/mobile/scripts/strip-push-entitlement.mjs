#!/usr/bin/env node

// expo-notifications' config plugin unconditionally adds the aps-environment
// entitlement (Push Notifications capability) to every iOS build, even though
// this app only ever uses foreground local notifications and never sends
// remote push (issue #25 explicitly defers remote push to a future relay
// milestone). That entitlement requires the App ID to have Push Notifications
// capability enabled in the Apple Developer portal, which a free/personal-team
// automatic-signing provisioning profile cannot have — builds fail with
// "Provisioning Profile ... does not support the Push Notifications capability"
// before ever reaching a real device.
//
// Removing it via a config plugin (withEntitlementsPlist / withDangerousMod)
// turned out to be unreliable: @expo/config-plugins registers exactly one
// handler per mod name ("entitlements"), and composing cleanly with whatever
// expo-notifications' own plugin already registered depends on internal
// ordering semantics that didn't behave as documented in practice. Instead,
// this runs as a plain post-prebuild step — after `expo prebuild` has fully
// written the native project, strip the entitlement directly from the
// generated .entitlements file(s). Simple, deterministic, no dependency on
// config-plugin internals.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const iosDir = join(mobileRoot, "ios");

function findEntitlementsFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.name === "Pods" || entry.name === "build") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findEntitlementsFiles(full));
    } else if (entry.name.endsWith(".entitlements")) {
      results.push(full);
    }
  }
  return results;
}

// Matches a single `<key>aps-environment</key>` entry and its following
// value element (string/plist scalars only — that is the only shape
// expo-notifications ever writes for this key).
const APS_ENTITLEMENT_PATTERN =
  /\s*<key>aps-environment<\/key>\s*\n\s*<(string|true\/|false\/)[^>]*>[^<]*(<\/\1>)?\s*\n?/;

let changed = 0;
for (const path of findEntitlementsFiles(iosDir)) {
  const before = readFileSync(path, "utf8");
  const after = before.replace(APS_ENTITLEMENT_PATTERN, "\n");
  if (after !== before) {
    writeFileSync(path, after);
    changed += 1;
    console.log(`[strip-push-entitlement] removed aps-environment from ${path}`);
  }
}

if (changed === 0) {
  console.log("[strip-push-entitlement] no aps-environment entitlement found (nothing to do)");
}
