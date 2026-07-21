# Android APK 发布

> [!IMPORTANT]
> 当前尚未向用户发布 Android APK。本文件是维护者使用的打包与发布准备说明，不是可用下载的安装指南。当前公开分发只提供 daemon 与 iOS TestFlight。

Herdr Connect 的 Android MVP 不依赖 EAS。发布流程使用 Expo prebuild 生成原生工程，再由 Gradle 构建经过 release keystore 签名的 APK 和 AAB。

## 用户获得什么

- `herdr-connect-<tag>-android.apk`：可直接下载并侧载安装。
- `herdr-connect-<tag>-android.aab`：供后续上传 Google Play，不可直接安装。
- `SHA256SUMS`：用于验证下载文件完整性。

这些文件会附加到对应 tag 的 GitHub Release；带连字符的 tag（例如历史上的 `v0.1.0-preview.1`）会对应 GitHub prerelease。首次安装 APK 时，Android 可能要求用户允许浏览器或文件管理器“安装未知应用”。

## GitHub Actions secrets

在仓库的 `Settings → Secrets and variables → Actions` 中配置以下 repository secrets：

| Secret | 含义 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | release keystore 文件的 Base64 内容，不包含换行要求 |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 密码 |
| `ANDROID_KEY_ALIAS` | release key alias |
| `ANDROID_KEY_PASSWORD` | release key 密码 |
| `ANDROID_SIGNING_CERT_SHA256` | release 证书 SHA-256 指纹，可带或不带冒号 |

生成 Base64 内容时不要把 keystore 或编码结果写入仓库：

```bash
base64 < herdr-connect-release.jks | tr -d '\n'
```

证书指纹可以在本机读取：

```bash
keytool -list -v \
  -keystore herdr-connect-release.jks \
  -alias herdr-connect \
  | grep SHA256
```

release keystore 是后续更新同一个 Android 应用的长期身份凭据。必须在密码管理器或离线介质中备份；丢失后，GitHub Release 用户无法无缝安装同一 package name 的升级包。

## 自动发布

[Android Release workflow](../../.github/workflows/android-release.yml) 响应两种入口：

1. 推送形如 `v0.1.0-preview.1` 的 tag：构建产物，等待 daemon workflow 创建对应 GitHub Release，然后上传产物。
2. 手动运行 workflow，并输入一个已经存在于仓库和 GitHub Releases 中的 tag。

daemon 和 Android workflow 会并行构建；Android workflow 最多等待五分钟，不会自行创建 Release，从而避免两个 workflow 对同一版本的 prerelease 状态产生竞争。

## 本机构建

先安装 Node.js、pnpm、Java 17、Android SDK Build Tools，并安装仓库依赖。然后设置签名环境变量：

```bash
export ANDROID_KEYSTORE_PATH=/absolute/path/herdr-connect-release.jks
export ANDROID_KEYSTORE_PASSWORD='...'
export ANDROID_KEY_ALIAS='herdr-connect'
export ANDROID_KEY_PASSWORD='...'
export ANDROID_SIGNING_CERT_SHA256='AA:BB:...'
export ANDROID_ARTIFACT_BASENAME='herdr-connect-v0.1.0-preview.1-android'

apps/mobile/scripts/android-release.sh
```

脚本会执行以下保护：

- 缺少 keystore、密码、alias 或期望证书指纹时立即失败。
- 检查 keystore 没有被 Git 跟踪。
- 用期望 SHA-256 指纹验证 keystore 和最终 APK 的证书。
- 拒绝使用 Android Debug 证书的 APK。
- 用 `apksigner` 验证 APK，并用 `jarsigner` 验证 AAB。
- 不会把 keystore、密码或证书内容复制进发布目录。

最终产物位于根目录 `dist/android/`。`android/` 原生工程由 Expo 临时生成并已被 `.gitignore` 排除。

## 当前配置与后续素材

当前 `apps/mobile/app.config.ts` 已包含 Android package name、`versionCode` 和局域网发现权限。每次发布新版本前必须递增 `android.versionCode`，并确认 Android 端原生模块与当前 LAN-only 安全模型（TLS pinning、配对、设备凭据）一致。

正式对外推广前仍应补充应用图标和 Android adaptive icon。

不要把 keystore、签名密码或 Base64 内容提交到 Git，也不要把 debug/unsigned APK 重命名成 release 产物。
