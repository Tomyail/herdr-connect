# 安装 daemon 预览版

[English](../../../docs/release/daemon.md)

Herdr Connect 为 macOS、Linux 和 Windows 提供预编译 daemon 压缩包。当前公开 build 是 [v0.1.0-preview.1](https://github.com/Tomyail/herdr-connect/releases/tag/v0.1.0-preview.1)。这是用于可信局域网的早期预览，不是生产级远程访问服务。

## 选择下载文件

下载与电脑匹配的压缩包：

| 平台 | 架构 | 资产后缀 |
| --- | --- | --- |
| macOS | Apple Silicon | `darwin_arm64.tar.gz` |
| macOS | Intel | `darwin_amd64.tar.gz` |
| Linux | ARM64 | `linux_arm64.tar.gz` |
| Linux | x86-64 | `linux_amd64.tar.gz` |
| Windows | x86-64 | `windows_amd64.zip` |

Release 还包含 `SHA256SUMS`。使用 daemon 压缩包不需要安装 Go、Node.js、pnpm 或 Expo。

## 校验并运行

解压后，在 macOS 或 Linux 上按需添加可执行权限并检查能力：

```sh
chmod +x herdr-connect
./herdr-connect --source fake capabilities
```

确认单独安装的 `herdr` CLI 可用，然后启动 LAN demo：

```sh
herdr agent list
./herdr-connect --source herdr diagnostics
./herdr-connect --source herdr demo-lan
```

Windows 用户可从 PowerShell 或命令提示符运行 `herdr-connect.exe`。daemon 监听 TCP `9808` 并广播 `_herdr-connect._tcp`。保持前台运行，结束时按 `Ctrl+C`。

当前 demo 没有配对、认证或加密。只能在可信网络中使用，不得输入秘密，并在测试后停止。iPhone 和 daemon 主机必须位于同一个局域网；远程连接是后续 TODO。

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

## 已知限制

- 二进制没有经过 Apple notarization 或 Windows code signing，操作系统可能显示来源警告。
- 本预览版没有发布 Android APK。
- 配对、设备认证、端到端加密和远程连接尚未实现。

源码环境与开发命令参见[项目 README](../README.md)。
