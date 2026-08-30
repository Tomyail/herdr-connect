#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = resolve(mobileRoot, "ios/HerdrConnect.xcworkspace");
const bundleId = "com.tomyail.herdrconnect";
const scheme = "HerdrConnect";
const buildRoot = resolve(mobileRoot, "build/screenshots");
const derivedDataPath = resolve(buildRoot, "DerivedData");
const rawRoot = resolve(buildRoot, "raw");
const marketingRoot = resolve(buildRoot, "marketing");
const composerSource = resolve(mobileRoot, "scripts/compose_app_store_screenshots.swift");
const composerBinary = resolve(buildRoot, "screenshot-composer");
const metroPort = Number(process.env.SCREENSHOT_METRO_PORT || 8081);
let startedMetro;

const DEVICE_NAMES = {
  // iPhone 13 Pro Max produces the 1284x2778 pixels accepted by
  // APP_IPHONE_65; newer Pro Max simulators produce the separate 6.9-inch
  // 1320x2868 slot.
  iphone: "iPhone 13 Pro Max",
  ipad: "iPad Pro 13-inch (M5)",
};

const DISPLAY_TYPES = {
  iphone: "APP_IPHONE_65",
  ipad: "APP_IPAD_PRO_3GEN_129",
};

function usage() {
  console.log(`用法：pnpm screenshots -- [选项]

选项：
  --device iphone|ipad|all            设备类型（默认 all）
  --scene agents|detail|settings|all  截图场景（默认 all）
  --locale en-US|zh-Hans|all          语言（默认 all）
  --skip-build                        使用已有 Debug Simulator 构建
  --raw-only                          只生成原始截图，不生成营销版
  --compose-only                      使用已有原始截图生成营销版
`);
}

function parseArgs(argv) {
  const options = {
    device: "all",
    scene: "all",
    locale: "all",
    skipBuild: false,
    rawOnly: false,
    composeOnly: false,
  };
  const argumentsList = argv[0] === "--" ? argv.slice(1) : argv;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--help" || argument === "-h") {
      usage();
      process.exit(0);
    }
    if (argument === "--skip-build") {
      options.skipBuild = true;
      continue;
    }
    if (argument === "--raw-only") {
      options.rawOnly = true;
      continue;
    }
    if (argument === "--compose-only") {
      options.composeOnly = true;
      continue;
    }
    if (argument === "--device" || argument === "--scene" || argument === "--locale") {
      const value = argumentsList[++index];
      if (!value) throw new Error(`${argument} 缺少值。`);
      options[argument.slice(2)] = value;
      continue;
    }
    throw new Error(`未知参数：${argument}`);
  }
  if (!["iphone", "ipad", "all"].includes(options.device)) {
    throw new Error(`不支持的设备类型：${options.device}`);
  }
  if (!["agents", "detail", "settings", "all"].includes(options.scene)) {
    throw new Error(`不支持的截图场景：${options.scene}`);
  }
  if (options.rawOnly && options.composeOnly) {
    throw new Error("--raw-only 和 --compose-only 不能同时使用。");
  }
  if (!["en-US", "zh-Hans", "all"].includes(options.locale)) {
    throw new Error(`不支持的语言：${options.locale}`);
  }
  return options;
}

function run(command, args, { allowFailure = false, silent = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: mobileRoot,
    env: process.env,
    stdio: silent ? "ignore" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${command} ${args.join(" ")} 执行失败（退出码 ${result.status ?? "unknown"}）。`);
  }
  return result.status ?? 1;
}

function runCapture(command, args) {
  const result = spawnSync(command, args, {
    cwd: mobileRoot,
    env: process.env,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} 执行失败：${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function metroIsRunning() {
  const result = spawnSync("curl", ["-fsS", `http://127.0.0.1:${metroPort}/status`], {
    cwd: mobileRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 && result.stdout.includes("packager-status:running");
}

async function ensureMetro() {
  if (metroIsRunning()) return;

  startedMetro = spawn(
    "pnpm",
    ["exec", "expo", "start", "--dev-client", "--localhost", "--port", String(metroPort)],
    {
      cwd: mobileRoot,
      env: process.env,
      stdio: "ignore",
    },
  );

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (metroIsRunning()) return;
    await sleep(500);
  }
  throw new Error(`Metro 在 ${metroPort} 端口启动超时。`);
}

function clearPngs(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".png")) {
      unlinkSync(join(directory, entry.name));
    }
  }
}

function findApp(directory) {
  if (!existsSync(directory)) return undefined;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name === `${scheme}.app`) return path;
    if (entry.isDirectory()) {
      const nested = findApp(path);
      if (nested) return nested;
    }
  }
  return undefined;
}

function availableDeviceUdid(name) {
  const listing = JSON.parse(runCapture("xcrun", ["simctl", "list", "devices", "available", "-j"]));
  for (const runtimes of Object.values(listing.devices ?? {})) {
    for (const device of runtimes) {
      if (device.name === name && device.isAvailable) return device.udid;
    }
  }
  throw new Error(`找不到可用的 Simulator：${name}`);
}

function bootDevice(udid) {
  run("xcrun", ["simctl", "boot", udid], { allowFailure: true, silent: true });
  run("xcrun", ["simctl", "bootstatus", udid, "-b"]);
  run("xcrun", ["simctl", "ui", udid, "appearance", "light"]);
  run("xcrun", [
    "simctl",
    "status_bar",
    udid,
    "override",
    "--time",
    process.env.SCREENSHOT_STATUS_TIME || "9:41",
    "--batteryLevel",
    "100",
    "--batteryState",
    "charged",
    "--wifiBars",
    "3",
    "--dataNetwork",
    "wifi",
  ]);
}

function setSimulatorLocale(udid, locale) {
  const language = locale === "zh-Hans" ? "zh-Hans" : "en-US";
  const appleLocale = locale === "zh-Hans" ? "zh_CN" : "en_US";
  run("xcrun", ["simctl", "spawn", udid, "defaults", "write", "NSGlobalDomain", "AppleLanguages", "-array", language]);
  run("xcrun", ["simctl", "spawn", udid, "defaults", "write", "NSGlobalDomain", "AppleLocale", appleLocale]);
  // iPadOS renders the date in the status bar. Reboot so the system chrome
  // follows the locale of the screenshot, not the developer's host locale.
  run("xcrun", ["simctl", "shutdown", udid], { allowFailure: true, silent: true });
  bootDevice(udid);
}

function buildSimulator(udid) {
  if (!existsSync(workspace)) {
    run("node", ["scripts/ios-release.mjs", "prepare"]);
  }
  mkdirSync(buildRoot, { recursive: true });
  run("asc", [
    "xcode",
    "build",
    "--workspace",
    workspace,
    "--scheme",
    scheme,
    "--configuration",
    "Debug",
    "--destination",
    `platform=iOS Simulator,id=${udid}`,
    "--derived-data-path",
    derivedDataPath,
    "--no-code-signing",
    "--clean",
  ]);
  const app = findApp(resolve(derivedDataPath, "Build/Products"));
  if (!app) throw new Error(`Debug 构建完成但找不到 ${scheme}.app。`);
  return app;
}

function findNode(value, predicate) {
  if (Array.isArray(value)) {
    for (const child of value) {
      const match = findNode(child, predicate);
      if (match) return match;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  if (predicate(value)) return value;
  for (const child of Object.values(value)) {
    const match = findNode(child, predicate);
    if (match) return match;
  }
  return undefined;
}

function describeSimulator(udid) {
  try {
    return JSON.parse(runCapture("axe", ["describe-ui", "--udid", udid]));
  } catch {
    return undefined;
  }
}

function hasScreenshotScene(value) {
  return Boolean(findNode(value, (node) => {
    const label = String(node.AXLabel || "");
    const title = String(node.title || "");
    return label.includes("app-store-screenshot-ready") ||
      label.includes("Agents overview") ||
      label.includes("Agent 概览") ||
      title.includes("Agents overview") ||
      title.includes("Agent 概览");
  }));
}

function tapDevelopmentServer(value, udid) {
  const serverButton = findNode(value, (node) => {
    const label = String(node.AXLabel || "");
    return (node.role === "AXButton" || node.type === "Button") && label.includes("http");
  });
  const frame = serverButton?.frame;
  if (!frame) return false;
  run("axe", [
    "tap",
    "-x",
    String(frame.x + frame.width / 2),
    "-y",
    String(frame.y + frame.height / 2),
    "--udid",
    udid,
  ]);
  return true;
}

async function waitForAppScene(udid) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const ui = describeSimulator(udid);
    if (hasScreenshotScene(ui)) return;
    if (tapDevelopmentServer(ui, udid)) {
      await sleep(1_500);
      continue;
    }
    await sleep(500);
  }
  throw new Error("等待 React Native 截图场景加载超时；请检查 Metro 是否可访问。");
}

async function capture({ app, udid, device, scene, locale }) {
  const deviceDirectory = resolve(rawRoot, locale, device);
  mkdirSync(deviceDirectory, { recursive: true });

  run("xcrun", ["simctl", "terminate", udid, bundleId], { allowFailure: true, silent: true });
  run("xcrun", ["simctl", "uninstall", udid, bundleId], { allowFailure: true, silent: true });
  run("xcrun", ["simctl", "install", udid, app]);
  run("xcrun", [
    "simctl",
    "launch",
    "--terminate-running-process",
    udid,
    bundleId,
    "-appStoreScreenshotScene",
    scene,
    "-appStoreScreenshotLocale",
    locale,
    // Keep Expo Dev Client chrome out of the captured frame.
    "-EXDevMenuShowFloatingActionButton",
    "NO",
    "-EXDevMenuShowsAtLaunch",
    "NO",
    "-EXDevMenuIsOnboardingFinished",
    "YES",
  ]);

  await waitForAppScene(udid);
  // `asc screenshots capture --bundle-id` launches the app itself and cannot
  // pass our scene arguments. Run an asc plan without a launch step instead;
  // the app process above remains alive with the selected fixture scene.
  const planPath = resolve(buildRoot, `plan-${device}-${locale}-${scene}.json`);
  writeFileSync(
    planPath,
    JSON.stringify(
      {
        version: 1,
        app: { bundle_id: bundleId, udid, output_dir: deviceDirectory },
        steps: [{ action: "wait", duration_ms: 1000 }, { action: "screenshot", name: scene }],
      },
      null,
      2,
    ),
  );
  try {
    run("asc", ["screenshots", "run", "--plan", planPath]);
  } finally {
    unlinkSync(planPath);
  }
  run("xcrun", ["simctl", "terminate", udid, bundleId], { allowFailure: true, silent: true });
}

function composeMarketingScreenshots(devices, locales) {
  if (!existsSync(composerSource)) {
    throw new Error(`找不到营销截图 composer：${composerSource}`);
  }

  mkdirSync(marketingRoot, { recursive: true });
  run("xcrun", ["swiftc", "-parse-as-library", composerSource, "-o", composerBinary]);

  for (const locale of locales) {
    for (const device of devices) {
      const rawDirectory = resolve(rawRoot, locale, device);
      const outputDirectory = resolve(marketingRoot, locale, device);
      mkdirSync(outputDirectory, { recursive: true });
      clearPngs(outputDirectory);

      run(composerBinary, [rawDirectory, outputDirectory, locale, device]);
      run("asc", [
        "screenshots",
        "validate",
        "--path",
        outputDirectory,
        "--device-type",
        DISPLAY_TYPES[device],
        "--output",
        "json",
      ]);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const devices = options.device === "all" ? ["iphone", "ipad"] : [options.device];
  const scenes = options.scene === "all" ? ["agents", "detail", "settings"] : [options.scene];
  const locales = options.locale === "all" ? ["en-US", "zh-Hans"] : [options.locale];

  if (!options.composeOnly) {
    await ensureMetro();
    mkdirSync(rawRoot, { recursive: true });
  }

  if (!options.composeOnly) {
    for (const device of devices) {
      const udid = availableDeviceUdid(DEVICE_NAMES[device]);
      bootDevice(udid);
      const app = options.skipBuild
        ? findApp(resolve(derivedDataPath, "Build/Products"))
        : buildSimulator(udid);
      if (!app) throw new Error("--skip-build 指定的 DerivedData 中找不到 HerdrConnect.app。");

      for (const locale of locales) {
        setSimulatorLocale(udid, locale);
        clearPngs(resolve(rawRoot, locale, device));
        for (const scene of scenes) {
          console.log(`\n截取 ${device}/${locale}/${scene} …`);
          await capture({ app, udid, device, scene, locale });
        }
      }
    }
  }

  if (!options.rawOnly) {
    composeMarketingScreenshots(devices, locales);
  }

  console.log(`\n完成。原始截图位于：${rawRoot}`);
  if (!options.rawOnly) {
    console.log(`营销截图位于：${marketingRoot}`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (startedMetro && !startedMetro.killed) startedMetro.kill("SIGTERM");
  });
