# Herdr Connect

[English](../../README.md)

Herdr Connect 是 [Herdr](https://github.com/ogulcancelik/herdr) 的实验性、本地优先配套项目。第一个公开里程碑刻意保持小范围：让移动设备能够在同一局域网内可靠发现 Herdr Connect daemon。

> [!WARNING]
> 当前 LAN demo 没有配对、设备认证或端到端加密。近期终端输出和文本输入通过未加密 HTTP 传输。只能在可信、可控的网络中运行，不得输入秘密，并在测试结束后停止 daemon。

## 项目状态

Herdr Connect 目前是早期预览，不是可用于生产环境的远程访问产品。

| 能力 | 状态 |
| --- | --- |
| Bonjour/mDNS daemon 广播 | 实验性 |
| iOS 真机发现 | 已有 demo |
| Agent 列表、近期输出、焦点切换和文本输入 | 仅限不安全 LAN demo |
| Android 真机验证 | 尚未完成 |
| 配对、认证和 E2EE | 尚未实现 |
| Relay、推送和远程访问 | 后期研究方向 |

## 当前目标

当前公开里程碑是 **LAN Discovery Preview**：

- Go daemon 广播 `_herdr-connect._tcp`；
- 移动客户端在同一局域网内发现 daemon；
- 明确呈现正在发现、已发现、权限拒绝、超时和不可用状态；
- 为本地网络权限、VPN、multicast、防火墙和客户端隔离问题提供有用诊断；
- 使用真机验证发现链路。

发现只能证明实例可达，不建立信任，也不授予读取或操作 Agent 的权限。

## 安装预览版

首个可下载预览版通过三个渠道提供：

- 在 [GitHub Releases](https://github.com/Tomyail/herdr-connect/releases) 下载 macOS、Linux 和 Windows 的预编译 Go daemon；
- 在同一个 Release 下载已经签名的 Android APK；
- iOS 通过 TestFlight 分发，首个外部测试版本通过 Apple 审核后会在这里补充公开测试链接。

使用这些产物不需要安装 Go、Node.js、pnpm 或 Expo。具体参见 [daemon 安装说明](../release/daemon.md)、[Android APK 说明](../release/android-apk.md)和 [iOS TestFlight 发布说明](../release/ios-testflight.md)。下面的源码运行方式继续供贡献者使用。

## 架构

```text
Herdr CLI
    │ 命令行参数与 JSON
    ▼
Herdr Connect daemon
    │ Bonjour / mDNS + 本地 HTTP demo
    ▼
Expo / React Native 移动客户端
```

Herdr 作为独立程序运行，必须单独安装。Herdr Connect 通过 CLI 与其交互，不嵌入或链接 Herdr 源码。

## 环境要求

当前已验证的 iOS demo 需要：

- macOS，并已安装可用的 `herdr` CLI；
- Go 1.24 或更高版本；
- 推荐 Node.js 24；
- pnpm 10.28.1；
- Xcode 与一台 iPhone 真机；
- Mac 和 iPhone 位于同一个可信 Wi-Fi，且没有客户端隔离；
- development build 已获得本地网络权限。

移动端使用原生 Bonjour 模块，因此必须使用 Expo development build，不能使用 Expo Go 代替。

## 快速开始

安装 JavaScript 依赖：

```sh
corepack enable
pnpm install --frozen-lockfile
```

确认 Herdr 可用并至少存在一个 Agent：

```sh
herdr agent list
```

启动 LAN demo daemon：

```sh
pnpm demo:lan
```

daemon 默认监听 TCP `9808` 并广播 `_herdr-connect._tcp`。

将 Expo development build 安装到已连接的 iPhone：

```sh
pnpm ios:mobile
```

后续开发时启动 Metro：

```sh
pnpm dev:mobile
```

iOS 请求权限时允许本地网络访问。完整操作、安全边界、验收清单和故障排查参见[受控局域网 demo 指南](../demo/lan-ios-agent-list.md)。

## 开发

| 命令 | 用途 |
| --- | --- |
| `pnpm demo:lan` | 运行当前基于 Herdr 的 LAN demo |
| `pnpm dev:mobile` | 启动 Expo 开发服务器 |
| `pnpm ios:mobile` | 构建并安装 iOS development client |
| `pnpm typecheck` | 检查 TypeScript packages 和移动端类型 |
| `pnpm test:go` | 运行 Go 测试 |
| `pnpm test:ts` | 运行 TypeScript protocol 测试 |
| `pnpm test:conformance` | 运行 Go/TypeScript protocol 一致性测试 |
| `pnpm test` | 运行完整测试套件 |

仓库结构：

```text
apps/mobile/       Expo / React Native 移动客户端
cmd/               Go 命令入口
internal/          daemon、LAN demo、Herdr adapter、projection 与存储
packages/protocol/ TypeScript protocol 实现
protocol/          Go protocol 实现与测试向量
docs/              技术与协作文档
```

## 路线图

1. 可靠的跨平台局域网发现。
2. 经过认证的局域网只读连接。
3. 将安全远程连接和通知作为后期研究方向。

远程访问不属于当前发布承诺。项目会根据真实使用反馈调整路线图。

## 安全

不要在公开 Issue 中报告漏洞、凭据、私有 prompt、Agent 输出或敏感路径。项目会在具备生产能力的版本发布前提供私密报告渠道。

在认证和加密实现以前，只能把 `demo-lan` 视为用于受控环境的不安全开发工具。

## 贡献

项目仍处于早期范围收敛阶段。欢迎通过 [GitHub Issues](https://github.com/Tomyail/herdr-connect/issues) 提交缺陷、可复现的发现失败、文档修正和设计反馈。

提交代码前，请先创建 Issue，确认改动属于当前 LAN discovery 里程碑。仓库约定参见 [AGENTS.md](../../AGENTS.md)。

## 与 Herdr 的关系

Herdr Connect 是独立的配套项目，与 Herdr 项目不存在隶属或官方背书关系。Herdr 需要单独安装，并遵守其自身许可证与项目政策。

## 许可证

本项目采用 [Apache License 2.0](../../LICENSE)。
