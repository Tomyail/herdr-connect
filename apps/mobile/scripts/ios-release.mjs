#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const iosWorkspace = resolve(mobileRoot, "ios/HerdrConnect.xcworkspace");
const scheme = "HerdrConnect";
const appIdentifier = "com.tomyail.herdrconnect";
const artifactDirectory = resolve(mobileRoot, "build/ios");
const archivePath = resolve(artifactDirectory, "HerdrConnect.xcarchive");
const ipaPath = resolve(artifactDirectory, "HerdrConnect.ipa");

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
  if (
    typeof config.ios?.infoPlist?.NSPhotoLibraryUsageDescription !== "string" ||
    config.ios.infoPlist.NSPhotoLibraryUsageDescription.trim() === ""
  ) {
    errors.push("ios.infoPlist.NSPhotoLibraryUsageDescription 必须是非空字符串");
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
  if (process.env.CI_XCODE_CLOUD === "TRUE") {
    run("pod", ["install", "--project-directory=ios"]);
  } else {
    run("bundle", ["exec", "pod", "install", "--project-directory=ios"]);
  }
  if (!existsSync(iosWorkspace)) {
    throw new Error(`Pod install 完成后仍未找到 workspace：${iosWorkspace}`);
  }
  console.log(`iOS 工程已准备：Herdr Connect ${config.version} (${config.ios.buildNumber})`);
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`缺少环境变量 ${name}。`);
  }
  return value;
}

function truthyEnv(name, defaultValue = false) {
  const value = process.env[name];
  if (value == null || value === "") return defaultValue;
  return ["1", "true", "yes", "y"].includes(value.toLowerCase());
}

function assertWorkspace() {
  if (!existsSync(iosWorkspace)) {
    throw new Error(`找不到 iOS workspace：${iosWorkspace}。请先运行 pnpm release:ios:prepare。`);
  }
}

function appendXcodeBuildFlags(args) {
  args.push("--xcodebuild-flag=-allowProvisioningUpdates");
  const team = process.env.APPLE_DEVELOPMENT_TEAM?.trim();
  if (team) args.push(`--xcodebuild-flag=DEVELOPMENT_TEAM=${team}`);
}

/** Build a signed local IPA using asc's Xcode wrappers. */
function build() {
  validateConfig();
  assertWorkspace();
  requiredEnv("APPLE_DEVELOPMENT_TEAM");

  run("mkdir", ["-p", artifactDirectory]);
  const archiveArgs = [
    "xcode",
    "archive",
    "--workspace",
    iosWorkspace,
    "--scheme",
    scheme,
    "--configuration",
    "Release",
    "--archive-path",
    archivePath,
    "--clean",
    "--overwrite",
  ];
  appendXcodeBuildFlags(archiveArgs);
  run("asc", archiveArgs);

  const exportArgs = [
    "xcode",
    "export",
    "--archive-path",
    archivePath,
    "--ipa-path",
    ipaPath,
    "--method",
    "app-store-connect",
    "--overwrite",
  ];
  appendXcodeBuildFlags(exportArgs);
  run("asc", exportArgs);
}

function upload() {
  validateConfig();
  const ipa = process.env.IPA_PATH?.trim() || ipaPath;
  if (!existsSync(ipa)) {
    throw new Error(`找不到 IPA：${ipa}。请先运行 pnpm release:ios:build，或设置 IPA_PATH。`);
  }
  run("asc", [
    "builds",
    "upload",
    "--app",
    appIdentifier,
    "--ipa",
    ipa,
    "--wait",
  ]);
}

function distribute() {
  const config = validateConfig();
  const changelog = process.env.TESTFLIGHT_CHANGELOG?.trim();
  if (!changelog) throw new Error("缺少 TESTFLIGHT_CHANGELOG。");
  const groups = requiredEnv("TESTFLIGHT_GROUPS")
    .split(",")
    .map((group) => group.trim())
    .filter(Boolean);
  if (groups.length === 0) throw new Error("TESTFLIGHT_GROUPS 至少需要一个测试组名称。");

  const args = [
    "publish",
    "testflight",
    "--app",
    appIdentifier,
    "--build-number",
    process.env.TESTFLIGHT_BUILD_NUMBER?.trim() || String(config.ios.buildNumber),
    "--group",
    groups.join(","),
    "--test-notes",
    changelog,
    "--locale",
    "en-US",
    "--wait",
  ];
  if (truthyEnv("TESTFLIGHT_NOTIFY")) args.push("--notify");
  if (truthyEnv("TESTFLIGHT_EXTERNAL")) args.push("--submit", "--confirm");
  run("asc", args);
}

const commands = { prepare, build, upload, distribute };

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
