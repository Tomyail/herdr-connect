# 安装 daemon

[English](../../../docs/release/daemon.md)

Herdr Connect 为 macOS、Linux 和 Windows 提供预编译 daemon 压缩包。当前公开 build 是 [v0.1.0-preview.2](https://github.com/Tomyail/herdr-connect/releases/tag/v0.1.0-preview.2)。daemon 是所有者侧的 LAN 服务：它与本机 Herdr CLI 交互、广播 `_herdr-connect._tcp`、提供 HTTPS LAN API，并在主机上保存配对与设备状态。

## 在 macOS 或 Linux 上快速安装

将当前 daemon 安装到 `~/.local/bin/herdr-connect`：

```sh
curl -fsSL https://raw.githubusercontent.com/Tomyail/herdr-connect/main/install.sh | sh
```

安装器会识别 Apple Silicon、Intel/AMD64 和 Linux ARM64，下载固定版本的 Release 压缩包，并在安装前使用 Release 的 `SHA256SUMS` 校验文件。安装过程不使用 `sudo`。

如需先审查脚本再运行：

```sh
curl -fsSL https://raw.githubusercontent.com/Tomyail/herdr-connect/main/install.sh -o install.sh
less install.sh
sh install.sh
```

需要时可以指定版本或安装目录：

```sh
curl -fsSL https://raw.githubusercontent.com/Tomyail/herdr-connect/main/install.sh \
  | HERDR_CONNECT_VERSION=v0.1.0-preview.2 HERDR_CONNECT_INSTALL_DIR="$HOME/bin" sh
```

Windows 用户继续使用下方的 zip 下载方式。

## 选择下载文件

下载与电脑匹配的压缩包：

| 平台 | 架构 | 资产后缀 |
| --- | --- | --- |
| macOS | Apple Silicon | `darwin_arm64.tar.gz` |
| macOS | Intel | `darwin_amd64.tar.gz` |
| Linux | ARM64 | `linux_arm64.tar.gz` |
| Linux | x86-64 | `linux_amd64.tar.gz` |
| Windows | x86-64 | `windows_amd64.zip` |

Release 还包含 `SHA256SUMS`。使用 daemon 压缩包不需要安装 Go、Node.js、pnpm 或 Expo。macOS 压缩包内的二进制额外使用 Developer ID Application 证书签名并经 Apple 公证，因此在 Mac 上双击或直接运行不会触发 Gatekeeper 的“无法验证开发者”拦截。

## 校验并运行

如果使用安装器，请先确认 Herdr 可用，再启动 daemon：

```sh
herdr agent list
~/.local/bin/herdr-connect doctor
~/.local/bin/herdr-connect service install
~/.local/bin/herdr-connect service status
```

服务以当前所有者身份运行：macOS 使用 LaunchAgent，Linux 使用 systemd user service。使用 `service logs`、`service logs --tail`、`service restart` 和 `service uninstall` 管理生命周期。卸载服务会保留二进制、数据库、日志、证书和已配对设备记录。

如果手动下载压缩包，请先解压。在 macOS 或 Linux 上按需添加可执行权限并检查能力：

```sh
chmod +x herdr-connect
./herdr-connect --source fake capabilities
```

确认单独安装的 `herdr` CLI 可用，然后启动 LAN 服务：

```sh
herdr agent list
./herdr-connect doctor
./herdr-connect service install
./herdr-connect service status
```

Windows 用户可从 PowerShell 或命令提示符运行 `herdr-connect.exe`。Windows 服务管理尚未实现；使用 App 期间请保持一个前台 `demo-lan` 进程运行：

```powershell
.\herdr-connect.exe doctor
.\herdr-connect.exe --source herdr demo-lan
```

## 配对手机

daemon 运行后，每部手机配对一次：

```sh
herdr-connect pair
```

该命令会打印 QR 码。在 iOS App 中打开“设置 → 配对新设备”并扫描它。配对会 pin daemon 证书指纹，并签发该设备专属的 bearer token。你可以在主机侧管理已配对设备：

```sh
herdr-connect devices list
herdr-connect devices revoke <device_id>
```

LAN 传输层是 HTTPS，daemon 使用自签 ECDSA P-256 证书，手机 pin 其 SHA-256 指纹。所有 Agent 端点都要求已配对设备的 bearer token；`/v1/pair` 只接受一次性 secret。这是受支持的 LAN-only 产品模型，不是临时演示流程。完整保证与边界见 [LAN TLS 与配对](../../security/lan-tls-pairing.md)。

## 校验 checksum

Linux：

```sh
sha256sum -c SHA256SUMS --ignore-missing
```

macOS：

```sh
shasum -a 256 herdr-connect_*.tar.gz
```

将输出与 `SHA256SUMS` 中对应记录比较。

## 校验 macOS 签名与公证

解压 macOS 压缩包后，可以在 Mac 上确认 Developer ID 签名和 Apple 公证记录：

```sh
codesign --verify --strict --verbose=2 herdr-connect
spctl -a -vvv --type execute herdr-connect
```

`spctl` 应输出 `accepted`，且 `source=Notarized Developer ID`。首次运行二进制时 Gatekeeper 会进行在线公证票据检查，因此首次启动需要联网。

## 已知限制

- macOS 二进制使用 Developer ID Application 证书签名并经 Apple 公证，Gatekeeper 不会拦截；Linux 与 Windows 二进制未做 code signing，操作系统可能显示来源警告，Windows 用户还会看到 SmartScreen 提示。
- Windows 服务管理尚未实现；Windows 上使用前台 `demo-lan` 命令。
- Android APK 尚未发布。
- 消息层 E2EE 与官方远程 relay 访问是未来里程碑；当前发布范围是 LAN-only。

源码环境与开发命令参见[项目 README](../README.md)。
CLI 帮助、诊断格式和退出码见 [CLI 指南](../cli.md)。
