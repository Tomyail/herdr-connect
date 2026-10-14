# iOS 发布流程（维护者）

[English](../../release/ios-release-process.md)

这是给维护者看的、通过 Xcode Cloud 发布新 TestFlight build 的操作手册，不面向最终用户；面向用户的安装说明见 [安装 iOS TestFlight 版本](ios-testflight.md)。

## 为什么 iOS 用独立的 tag 前缀

daemon 和 Android 发布共用 `v*` tag，并共享同一个 GitHub Release（由 `daemon-release.yml` 创建，`android-release.yml` 等它建好后再把产物传进去）。iOS 刻意**没有**加入这套机制：它用独立的 `ios-v*` 前缀，触发的是 Xcode Cloud 而不是 GitHub Actions。

如果 iOS 也复用 `v*`，会导致每次纯 daemon 改动的 tag 都白白触发一次 iOS 归档和上传；更糟的是，如果哪次忘了在无关的 tag 上先把 `buildNumber` 提一位，Xcode Cloud 那次上传会直接失败（App Store Connect 拒绝同一个 App 版本下重复使用的 build number）。

把三条发布线彻底分开不会带来运行时代价：daemon 和 App 的兼容性是靠 daemon 广播的 `api_version`、手机端检查（对应 `apps/mobile/src/i18n/errors.ts` 里的 `daemon_outdated` / `app_outdated`）来保证的，不是靠跨平台版本号对齐。所以 `ios-v*` 完全不需要和 daemon 的 `v*` 保持同步，包括所谓"大版本对齐"——那样做只会把这次拆分本来要省掉的协调成本又加回来。

## Xcode Cloud 配置（App Store Connect 后台）

这部分完全在 App Store Connect 后台配置，不在本仓库里：

- **开始条件（Start Condition）**：Tag Changes → 以...开头（Starts With）→ `ios-v`。
- **归档 - iOS 操作 → 分发准备**：选 `App Store Connect`（不要选"TestFlight（仅限内部测试）"——仅内部测试永远到不了公开的外部测试组）。
- **后续操作**：目前没有配置任何后续操作——workflow 只有 `Archive - iOS` 一个动作（2026-10-14 实测：`asc xcode-cloud workflows list --app <APP_ID>` 只返回一个 `ARCHIVE` 动作，没有 `postActions`）。所以上传完成后，对外部测试者而言 build 停在 `READY_FOR_BETA_SUBMISSION`，每次都要手动提交，见「打一次发布」第 4 步。如果加上一个 `TestFlight（外部测试）` 后续操作，这个手动步骤就可以去掉；第一次提交到某个外部测试组需要过一次 Beta App Review，之后同一个组、没改元数据的新 build 通常会自动通过。

## iOS 27 scene 生命周期

使用 iOS 27 SDK 构建的应用必须采用 UIScene 生命周期；Expo SDK 56 的 legacy AppDelegate-only 模板可能在应用启动前触发 trap。`apps/mobile/plugins/withIosSceneLifecycle.cjs` 在 prebuild 时添加 scene manifest，并在 AppDelegate.swift 内生成 SceneDelegate，将 window 创建移到 scene，同时向 Expo 转发链接和生命周期事件。Expo 官方提供等效 scene 支持后，在验证 iOS 27 启动与链接行为后可移除该 plugin 及 app.config.ts 中的注册。

## 打一次发布

1. build 号由 Xcode Cloud 自己分配：上传的 `CFBundleVersion` 是 workflow 的 build run number，不是 `apps/mobile/app.config.ts` 里的 `ios.buildNumber`。2026-10-13 实测——run #114 上传后 build 号是 `114`，而当时 `ios.buildNumber` 写的是 `101`。**发版不需要再去 bump `ios.buildNumber`**：它对上传结果没有影响，App Store Connect 也不会因为它是旧值而拒绝上传。该值仍会进入 `expo prebuild` 生成的 `Info.plist`，也是本地 `release:ios:upload` 路径使用的值，所以保留数字即可。
2. 打 tag 并 push。tag 里的数字随便取一个没用过的就行——它只需要唯一，不必等于 Xcode Cloud 将要分配的 build 号。**永远不要移动或者重新 push 一个已存在的 tag**——Xcode Cloud 认的是"tag 被创建"这个事件，强行移动一个 tag 既可能不会重新触发，也会让已经拉取过这个 tag 的人本地记录和远端对不上：

   ```sh
   git tag -a ios-v<version>-build<N> -m "ios-v<version>-build<N>"
   git push origin ios-v<version>-build<N>
   ```

   比如 `version` 还是 `"0.1.0"`，就打 `ios-v0.1.0-build102`；如果 `version` 本身也变了，就一起编进 tag，比如 `ios-v0.1.1-build103`。
3. 不打开浏览器也能盯构建：

   ```sh
   asc xcode-cloud build-runs list --workflow-id <WORKFLOW_ID>   # 用 asc xcode-cloud workflows list --app <APP_ID> 查 id
   asc xcode-cloud status --run-id <RUN_ID>
   ```

4. **必须手动把 build 提交到外部测试组。** workflow 里只有 `Archive - iOS` 一个动作，所以构建完成后 build 到达 App Store Connect 时是 `internalBuildState: READY_FOR_BETA_TESTING`、`externalBuildState: READY_FOR_BETA_SUBMISSION`——不提交的话，外部测试者（公开 TestFlight 链接）装不到：

   ```sh
   asc builds list --app <APP_ID>                                    # 取最新 build id，processingState 为 VALID
   asc testflight review submit --build-id <BUILD_ID> --confirm
   ```

   之后会走 Beta App Review（元数据没变时通常是自动通过），`externalBuildState` 变成 `BETA_APPROVED`。
