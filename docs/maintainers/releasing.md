# 发布维护说明

公开用户入口以英语为 canonical：

- daemon 安装说明：`docs/release/daemon.md`；
- iOS TestFlight 安装说明：`docs/release/ios-testflight.md`；
- 简体中文翻译：`docs/zh-CN/release/`。

本文件只记录维护者操作，不面向普通用户承诺尚未发布的产物。

## daemon

`v*` tag 会触发 `.github/workflows/daemon-release.yml`，运行测试并为 macOS、Linux 和 Windows 构建压缩包与 `SHA256SUMS`。带连字符的 tag 会创建 prerelease。当前公开版本为 `v0.1.0-preview.1`。

工作流目前不执行 Apple notarization 或 Windows code signing。创建后应核对 Release 的 tag、prerelease 状态、五个平台资产、`SHA256SUMS`，并确认压缩包中的 `README.md` 可独立使用。

## iOS TestFlight

iOS 使用 Xcode、Fastlane 和 App Store Connect 上传，不依赖 EAS 云构建。发布前递增 `apps/mobile/app.config.ts` 中的 `ios.buildNumber`，并在本机安全配置 Apple Team ID 与 App Store Connect API key。`.p8` 文件不得提交到仓库。

```sh
cd apps/mobile
pnpm release:ios:prepare
pnpm release:ios:build
pnpm release:ios:upload
```

公开外部测试组已通过 Beta App Review，邀请链接为 `https://testflight.apple.com/join/ZkRzJ6rm`。上传新 build 后仍需等待 Apple 处理，并在需要时再次提交 Beta App Review；用户文档不得把刚上传但尚未可用的 build 描述为已经发布。

分发前至少验证：真机局域网发现、App 版本与 build number、出口合规信息、Beta App Description、What to Test、反馈方式、隐私政策链接和公开邀请人数限制。

## Android

Android APK 尚未公开发布。打包与签名准备见 `docs/release/android-apk.md`。在真实签名产物附加到 GitHub Release 并完成验证以前，不得在 README、安装说明或模板中声称 Android APK 可下载。
