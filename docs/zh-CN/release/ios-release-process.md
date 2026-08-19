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
- **后续操作**：加一个 `TestFlight（外部测试）`，选中已经开了公开链接的那个外部测试组。第一次提交到某个外部测试组需要过一次 Beta App Review；之后同一个组、没改元数据的新 build 通常会自动通过。

## 打一次发布

1. 把 `apps/mobile/app.config.ts` 里的 `ios.buildNumber` 提一位。没有任何东西会自动做这件事：`ci_post_clone.sh` 每次 Xcode Cloud 运行时都会跑 `expo prebuild`，把这个写死的值直接写进 `Info.plist`。忘了提的话不会被静默复用——App Store Connect 会直接拒绝这次上传。
2. 把这次 bump 提交成一个 commit（比如 `release(ios): bump buildNumber to <N>`）。
3. push 之后再打 tag、push tag。**永远不要移动或者重新 push 一个已存在的 tag**——Xcode Cloud 认的是"tag 被创建"这个事件，强行移动一个 tag 既可能不会重新触发，也会让已经拉取过这个 tag 的人本地记录和远端对不上。每次都打一个全新的 tag：

   ```sh
   git tag -a ios-v<version>-build<buildNumber> -m "ios-v<version>-build<buildNumber>"
   git push origin ios-v<version>-build<buildNumber>
   ```

   比如把 `buildNumber` 提到 `"8"`、`version` 还是 `"0.1.0"` 没变，就打 `ios-v0.1.0-build8`；如果 `version` 本身也变了，就一起编进 tag，比如 `ios-v0.1.1-build9`。
4. 去 App Store Connect 的 Xcode Cloud 页面看这个 workflow 的运行记录，确认构建真的跑起来了；跑完之后去 TestFlight 确认新 build 已经处理完成。
