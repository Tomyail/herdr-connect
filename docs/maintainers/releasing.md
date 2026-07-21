# 发布维护说明

公开用户入口以英语为 canonical：

- daemon 安装说明：`docs/release/daemon.md`；
- iOS TestFlight 安装说明：`docs/release/ios-testflight.md`；
- 简体中文翻译：`docs/zh-CN/release/`。

本文件只记录维护者操作，不面向普通用户承诺尚未发布的产物。

## daemon

`v*` tag 会触发 `.github/workflows/daemon-release.yml`，运行测试并为 macOS、Linux 和 Windows 构建压缩包与 `SHA256SUMS`。工作流通过 Go `ldflags` 把去掉 `v` 前缀的 tag 注入 CLI，并在 Linux AMD64 build 上核对 `herdr-connect --version`；本地未注入 build 显示 `development`。带连字符的 tag 会创建 prerelease。当前公开版本为 `v0.1.0-preview.2`。

macOS（darwin arm64/amd64）在 macOS runner 上原生构建，并执行 Apple 签名与公证：用 Developer ID Application 证书 `codesign`（hardened runtime + secure timestamp），提交 `notarytool submit --wait` 公证，再尝试 `stapler staple` 并用 `spctl` 校验。公证失败（`--wait` 非零退出）会使 build job 失败，从而不发布未公证产物。所需 GitHub Secrets（证书与密钥均为 base64 编码内容）：

- `MACOS_CERTIFICATE`：Developer ID Application 证书导出的 `.p12`，`base64` 编码。
- `MACOS_CERTIFICATE_PWD`：导出该 `.p12` 时设置的密码。
- `APP_STORE_CONNECT_API_KEY`：App Store Connect API key 的 `.p8` 文件内容，`base64` 编码（该 key 需有 Developer ID 的公证权限）。
- `APP_STORE_CONNECT_API_KEY_ID`：API key 的 Key ID。
- `APP_STORE_CONNECT_API_KEY_ISSUER_ID`：API key 的 Issuer ID。

发布前确认这 5 个 secret 已配置；任一缺失，macOS build job 会在“Verify required macOS signing secrets”一步直接失败并给出提示。注意：裸 Mach-O 可执行文件由 Apple 限制，`stapler staple` 可能无法附加离线票据（workflow 在此情况下仅告警，不中断），但 `spctl` 在线校验是 Gatekeeper 行为的判定依据，公证本身仍然有效。

创建后应核对 Release 的 tag、prerelease 状态、五个平台资产、`SHA256SUMS`，确认压缩包中的 `README.md` 可独立使用，并抽查 macOS 产物的 `codesign`/`spctl` 输出（`source=Notarized Developer ID`）。Windows 产物仍不做 code signing，Homebrew tap 尚未接入（见 issue #28 后续范围）。

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
