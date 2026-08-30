# Herdr Connect

[English](../../README.md)

**在 iPhone 上掌控你的 Herdr Agent —— 中间没有云端。**

[![Herdr Connect — LAN Discovery Demo](https://img.youtube.com/vi/BxX4ijalnzI/maxresdefault.jpg)](https://youtu.be/BxX4ijalnzI)

Herdr Connect 是 [Herdr](https://github.com/ogulcancelik/herdr) 的配套应用。一眼看到每个 Agent 在做什么，阅读它们的最新输出、发送后续指令、任务完成时收到提醒 —— 数据始终留在你自己的网络里。

<p>
  <img src="../../assets/screenshot-agents.png" alt="Agent 列表" width="200" />
  <img src="../../assets/screenshot-detail.png" alt="Agent 详情" width="200" />
  <img src="../../assets/screenshot-settings.png" alt="设置" width="200" />
</p>

## 为什么选择 Herdr Connect

- **一目了然** —— 所有 Agent 的状态、工作区和近期活动集中在一个列表
- **贴身协作** —— 阅读输出、发送指令，或随时叫停正在进行的任务
- **完成即知** —— Agent 完成任务时，有声音、震动和通知提醒
- **天然私密** —— 手机直接与你的 daemon 通信，不经云端中继、无账号、无遥测

## 环境要求

- 一台运行 [Herdr](https://github.com/ogulcancelik/herdr) 且至少有一个 Agent 的电脑
- 一部 iPhone（Android 尚未发布）
- 两台设备处于同一网络 —— 家里的 Wi-Fi，或 Tailscale 这类能让它们互通的 VPN 虚拟局域网

## 快速开始

1. 确认 Herdr 已安装且至少有一个 Agent：

   ```sh
   herdr agent list
   ```

2. 在运行 Herdr 的电脑上安装 daemon（下载版不需要 Go、Node.js 或 Xcode）：

   ```sh
   curl -fsSL https://raw.githubusercontent.com/Tomyail/herdr-connect/main/install.sh | sh
   ```

   Windows 用户改从 [Releases 页面](https://github.com/Tomyail/herdr-connect/releases)下载并解压 zip。

3. 启动服务：

   ```sh
   ~/.local/bin/herdr-connect doctor
   ~/.local/bin/herdr-connect service install
   ```

4. 通过 **[Herdr Connect TestFlight 测试](https://testflight.apple.com/join/ZkRzJ6rm)** 安装 iOS App，并在系统提示时允许"本地网络"访问。

5. 配对手机。下面这条命令会打印一次性 QR 码 —— 在 App 的"设置 → 配对新设备"中扫描它：

   ```sh
   herdr-connect pair
   ```

6. 打开 Agents 页面。点击任意 Agent 即可查看输出、发送消息或叫停任务。

连不上？确认两台设备在同一网络，暂停会阻断本地组播的 VPN，检查防火墙或访客网络隔离设置。[daemon 指南](release/daemon.md)和 [TestFlight 故障排查](release/ios-testflight.md)有完整说明，[CLI 指南](cli.md)覆盖全部命令。

## 工作原理

```text
Herdr CLI
    │
Herdr Connect daemon   ← 运行在你的电脑上
    │
iPhone App             ← 配对后直接与 daemon 通信
```

daemon 和 App 在本地网络上互相发现。信任通过扫描配对命令打印的 QR 码一次性建立；此后手机只接受它配对过的那台 daemon。完整信任模型与当前边界见 [LAN TLS 与配对](../security/lan-tls-pairing.md)。

## 项目状态

| 领域 | 状态 |
| --- | --- |
| iOS App | 公开 TestFlight beta |
| 发现、配对、安全传输 | 已实现 |
| Agent 列表、输出、焦点切换、消息、叫停 | 已实现 |
| Android | 尚未发布 |
| 跨网络远程访问（relay + E2EE） | 未来里程碑 |

## 常见问题

**不在家时能用吗？**
官方 relay 是未来的里程碑，目前没有。如果你已经在用 Tailscale 这类 mesh VPN，只要手机能连到 daemon，App 就能正常工作；VPN 自身的安全由你负责。

**我的数据会上传到服务器吗？**
不会。App 直接与你网络内的 daemon 通信，没有云端中继，也没有账号系统。

**支持哪些 Herdr 版本？**
App 与 daemon 会协商版本，不匹配时会提示升级。详见 [daemon 指南](release/daemon.md)。

## 文档

| 读者 | 从这里开始 |
| --- | --- |
| 安装与配对 | [快速开始](#快速开始)、[daemon 指南](release/daemon.md)、[TestFlight 故障排查](release/ios-testflight.md) |
| CLI 参考 | [CLI 指南](cli.md) |
| 安全模型 | [LAN TLS 与配对](../security/lan-tls-pairing.md) |
| 架构与贡献者文档 | [OpenWiki](../../openwiki/quickstart.md)（英文） |

## 从源码开发

环境搭建、仓库布局和完整流程见 OpenWiki：[development setup](../../openwiki/development/setup.md)、[testing guide](../../openwiki/development/testing.md)（英文）。

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm demo:lan      # 本地 daemon，监听 TCP 9808
pnpm ios:mobile    # 在 iPhone 真机安装 Expo development build
```

App 依赖原生模块（mDNS、pinned TLS、相机、通知），请使用 Expo development build，不能用 Expo Go。

## 安全

不要在公开 Issue 中报告漏洞或敏感数据，请遵循 [SECURITY.md](SECURITY.md)。

## 贡献

欢迎在 [GitHub Issues](https://github.com/Tomyail/herdr-connect/issues) 提交缺陷、可复现的发现或配对问题和设计反馈。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 与 Herdr 的关系

Herdr Connect 是独立的配套项目，与 Herdr 项目不存在隶属或官方背书关系。Herdr 需单独安装，并遵守其自身许可证。

## 许可证

本项目采用 [Apache License 2.0](../../LICENSE)。
