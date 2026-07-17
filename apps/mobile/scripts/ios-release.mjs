#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const iosWorkspace = resolve(mobileRoot, "ios/HerdrConnect.xcworkspace");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: mobileRoot,
    env: process.env,
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function readExpoConfig() {
  const result = spawnSync("pnpm", ["exec", "expo", "config", "--json"], {
    cwd: mobileRoot,
    encoding: "utf8",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr || "无法读取 Expo 配置。\n");
    process.exit(result.status ?? 1);
  }

  return JSON.parse(result.stdout);
}

function validateConfig() {
  const config = readExpoConfig();
  const errors = [];

  if (config.ios?.bundleIdentifier !== "com.tomyail.herdrconnect") {
    errors.push("ios.bundleIdentifier 必须为 com.tomyail.herdrconnect");
  }
  if (!/^\d+$/.test(String(config.ios?.buildNumber ?? ""))) {
    errors.push("ios.buildNumber 必须是非空数字字符串");
  }
  if (config.ios?.infoPlist?.ITSAppUsesNonExemptEncryption !== false) {
    errors.push("ios.infoPlist.ITSAppUsesNonExemptEncryption 必须显式设为 false");
  }

  if (errors.length > 0) {
    throw new Error(`iOS 发布配置无效：\n- ${errors.join("\n- ")}`);
  }
  return config;
}

function prepare() {
  const config = validateConfig();
  const args = ["exec", "expo", "prebuild", "--platform", "ios", "--no-install"];
  if (["1", "true", "yes"].includes((process.env.EXPO_PREBUILD_CLEAN || "").toLowerCase())) {
    args.push("--clean");
  }

  run("pnpm", args);
  run("bundle", ["exec", "pod", "install", "--project-directory=ios"]);
  if (!existsSync(iosWorkspace)) {
    throw new Error(`Pod install 完成后仍未找到 workspace：${iosWorkspace}`);
  }
  console.log(`iOS 工程已准备：Herdr Connect ${config.version} (${config.ios.buildNumber})`);
}

function runFastlane(lane) {
  validateConfig();
  run("bundle", ["exec", "fastlane", "ios", lane]);
}

const commands = {
  prepare,
  build: () => runFastlane("testflight_build"),
  upload: () => runFastlane("testflight_upload"),
  distribute: () => runFastlane("testflight_distribute"),
};

const command = process.argv[2];
if (!command || !commands[command]) {
  console.error("用法：node scripts/ios-release.mjs <prepare|build|upload|distribute>");
  process.exit(1);
}

try {
  commands[command]();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
