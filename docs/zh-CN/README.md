# Herdr Connect

[English](../../README.md)

Herdr Connect 是 [Herdr](https://github.com/ogulcancelik/herdr) 的实验性、本地优先配套项目。第一个公开里程碑刻意保持小范围：让移动设备能够在同一局域网内可靠发现 Herdr Connect daemon。

## 5 分钟开始使用

你需要一台正在运行 [Herdr](https://github.com/ogulcancelik/herdr) 的电脑、一部 iPhone，并确保两台设备连接到同一个可信 Wi-Fi。当前预览版不支持 Android 或远程连接。

1. 确认 Herdr 已安装并且至少存在一个 Agent：

   ```sh
   herdr agent list
   ```

2. 安装 **v0.1.0-preview.2 daemon**。下载版 daemon 不需要 Go、Node.js、pnpm、Expo 或 Xcode。

   macOS 或 Linux：

   ```sh
   curl -fsSL https://raw.githubusercontent.com/Tomyail/herdr-connect/main/install.sh | sh
   ```

   Windows 用户从 [GitHub Releases](https://github.com/Tomyail/herdr-connect/releases/tag/v0.1.0-preview.2) 下载并解压对应的 zip。
3. 检查并启动 daemon。macOS/Linux 服务会在后台持续运行；Windows 用户在使用 App 期间需保持前台终端运行。

   macOS 或 Linux：

   ```sh
   ~/.local/bin/herdr-connect doctor
   ~/.local/bin/herdr-connect service install
   ~/.local/bin/herdr-connect service status
   ```

   Windows PowerShell 用户在解压目录中运行：

   ```powershell
   .\herdr-connect.exe doctor
   .\herdr-connect.exe --source herdr demo-lan
   ```

4. 在 iPhone 上加入公开的 **[Herdr Connect TestFlight 测试](https://testflight.apple.com/join/ZkRzJ6rm)**，安装 App，并在系统提示时允许访问本地网络。
5. 打开 Herdr Connect。App 应自动发现 daemon 并显示 Agent。点击 Agent 可以查看近期输出、切换焦点或发送文本。

如果没有成功发现，请确认两台设备连接同一个 Wi-Fi，暂时关闭 VPN，并检查防火墙或访客网络隔离设置。更多说明见 [daemon 指南](release/daemon.md)和 [TestFlight 故障排查](release/ios-testflight.md)。

完整命令、诊断输出、退出码和示例见 [CLI 指南](cli.md)。

> [!WARNING]
> 当前 LAN demo 没有配对、设备认证或端到端加密。近期终端输出和文本输入通过未加密 HTTP 传输。只能在可信、可控的网络中运行，不得输入秘密，并在测试结束后停止 daemon。

## 项目状态

Herdr Connect 目前是早期预览，不是可用于生产环境的远程访问产品。

| 能力 | 状态 |
| --- | --- |
| Bonjour/mDNS daemon 广播 | 实验性 |
| iOS 真机发现 | 已开放公开 TestFlight 预览 |
| Agent 列表、近期输出、焦点切换和文本输入 | 仅限不安全 LAN demo |
| Android App / APK | 尚未发布 |
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

## 从源码开发

下面的步骤面向参与 Herdr Connect 开发的贡献者。只想使用下载版预览时，请按照[“5 分钟开始使用”](#5-分钟开始使用)操作。

### 开发环境要求

当前已验证的 iOS demo 需要：

- macOS，并已安装可用的 `herdr` CLI；
- Go 1.24 或更高版本；
- 推荐 Node.js 24；
- pnpm 10.28.1；
- Xcode 与一台 iPhone 真机；
- Mac 和 iPhone 位于同一个可信 Wi-Fi，且没有客户端隔离；
- development build 已获得本地网络权限。

移动端使用原生 Bonjour 模块，因此必须使用 Expo development build，不能使用 Expo Go 代替。

### 源码开发设置

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
| `pnpm test:install` | 测试 macOS/Linux 安装脚本行为 |
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

不要在公开 Issue 中报告漏洞、凭据、私有 prompt、Agent 输出或敏感路径。请按照[安全政策](SECURITY.md)中的私密报告说明操作。

在认证和加密实现以前，只能把 `demo-lan` 视为用于受控环境的不安全开发工具。

## 贡献

项目仍处于早期范围收敛阶段。欢迎通过 [GitHub Issues](https://github.com/Tomyail/herdr-connect/issues) 提交缺陷、可复现的发现失败、文档修正和设计反馈。

提交代码前，请先创建 Issue，确认改动属于当前 LAN discovery 里程碑。请阅读[贡献指南](CONTRIBUTING.md)和仓库约定 [AGENTS.md](../../AGENTS.md)。

社区政策：[行为准则](CODE_OF_CONDUCT.md)、[安全政策](SECURITY.md)和[隐私政策](PRIVACY.md)。

## 与 Herdr 的关系

Herdr Connect 是独立的配套项目，与 Herdr 项目不存在隶属或官方背书关系。Herdr 需要单独安装，并遵守其自身许可证与项目政策。

## 许可证

本项目采用 [Apache License 2.0](../../LICENSE)。
