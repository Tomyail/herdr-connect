# iOS TestFlight 发布

Herdr Connect 的 iOS MVP 使用本机 Xcode 和 Fastlane 构建、上传，不依赖 EAS 云构建。Expo 只负责从 `app.config.ts` 生成原生 iOS 工程。

## 前置条件

- macOS 与当前稳定版 Xcode。
- 有效的 Apple Developer Program 会员。
- App Store Connect 中已创建 bundle identifier 为 `com.tomyail.herdrconnect` 的 App。
- Ruby、Bundler、Node.js 与 pnpm。
- Xcode 已登录具备签名权限的 Apple Account，或本机已安装对应证书和 provisioning profile。

安装依赖：

```bash
pnpm install
cd apps/mobile
bundle install
```

## 环境变量

构建 IPA 前设置 Apple Team ID：

```bash
export APPLE_DEVELOPMENT_TEAM="你的十位 Team ID"
```

上传和分发前设置 App Store Connect API key。`.p8` 文件只能保存在本机安全位置，不得提交到 Git：

```bash
export APP_STORE_CONNECT_API_KEY_KEY_ID="Key ID"
export APP_STORE_CONNECT_API_KEY_ISSUER_ID="Issuer ID"
export APP_STORE_CONNECT_API_KEY_KEY_FILEPATH="/绝对路径/AuthKey_XXXXXXXXXX.p8"
```

## 构建与上传

每次上传前，先确保 `apps/mobile/app.config.ts` 中的 `ios.buildNumber` 大于 App Store Connect 已存在的 build number，然后依次执行：

```bash
cd apps/mobile
pnpm release:ios:prepare
pnpm release:ios:build
pnpm release:ios:upload
```

各步骤职责如下：

- `prepare`：校验 bundle identifier、build number 和加密声明，然后执行 Expo iOS prebuild。
- `build`：由 Fastlane 调用 Xcode，生成 `apps/mobile/build/ios/HerdrConnect.ipa`。
- `upload`：只上传 IPA 并等待 App Store Connect 处理，不自动分发。

一般不要使用干净 prebuild，以免覆盖尚未配置为 Expo config plugin 的原生改动。确实需要重建原生工程时使用：

```bash
EXPO_PREBUILD_CLEAN=1 pnpm release:ios:prepare
```

## 分发给测试用户

build 在 App Store Connect 处理完成后，指定测试组和本次测试说明：

```bash
export TESTFLIGHT_GROUPS="Internal Testers"
export TESTFLIGHT_CHANGELOG="测试局域网内的 Herdr daemon 发现与连接。"
pnpm release:ios:distribute
```

默认按内部测试分发且不发送通知。分发给已经配置并通过 Beta App Review 的外部测试组时：

```bash
export TESTFLIGHT_EXTERNAL=1
export TESTFLIGHT_NOTIFY=1
export TESTFLIGHT_GROUPS="Public Beta Testers"
pnpm release:ios:distribute
```

需要指定非当前配置中的版本或 build 时，可额外设置 `TESTFLIGHT_VERSION` 和 `TESTFLIGHT_BUILD_NUMBER`。

## MVP 发布检查

1. 真机允许“本地网络”权限后能发现同一局域网内的 daemon。
2. App 名称、版本和 build number 在 TestFlight 中正确显示。
3. App Store Connect 的加密出口合规信息显示为不使用非豁免加密。
4. Beta App Description、What to Test、反馈邮箱和隐私政策链接已经填写。
5. 外部测试前已完成 Beta App Review，并确认公开邀请链接的测试人数限制。
