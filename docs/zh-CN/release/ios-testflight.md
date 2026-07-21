# 安装 iOS TestFlight App

[English](../../../docs/release/ios-testflight.md)

iOS App 通过 Apple TestFlight 分发：

**[加入 Herdr Connect TestFlight 测试](https://testflight.apple.com/join/ZkRzJ6rm)**

公开测试已经通过 Beta App Review 并向测试者开放。后续替换 build 在 Apple 处理或审核期间仍可能短暂不可用。

## 安装前准备

- 在 iPhone 上安装 Apple TestFlight App。
- 在电脑上安装并启动 [v0.1.0-preview.2 daemon](daemon.md)。
- 确保 iPhone 与 daemon 主机位于同一个可达局域网（物理 Wi-Fi，或让两端彼此可达的 VPN 虚拟局域网）。
- 确保 VPN 与防火墙没有阻止本地 multicast、到 TCP `9808` 的 HTTPS，或主机上的 daemon 防火墙规则。

## 在局域网连接

1. 在 iPhone 上打开 TestFlight 邀请并安装 Herdr Connect。
2. 启动 daemon。macOS/Linux 通常使用 `herdr-connect service install`；Windows 使用 `herdr-connect --source herdr demo-lan` 并保持前台终端运行。
3. 打开 Herdr Connect，并在 iOS 请求时允许“本地网络”访问。
4. 配对手机：在 daemon 主机运行 `herdr-connect pair`，然后在 App 中打开“设置 → 配对新设备”并扫描 QR 码。
5. 回到 Agents 页面。App 会发现 `_herdr-connect._tcp`，通过 pinned HTTPS 连接，并用已配对设备 token 调用 Agent API。

配对会 pin daemon 证书指纹，并用一次性 QR secret 换取每设备 bearer token。近期终端输出与文本输入只能通过已认证的 LAN API 访问。消息层 E2EE 不属于当前 LAN 发布范围，它保留给未来 relay 里程碑。完整信任模型见 [LAN TLS 与配对](../../security/lan-tls-pairing.md)。

## 故障排查

- 在 iOS 设置中确认 Herdr Connect 已获得“本地网络”权限。
- 如果 VPN 阻止本地 multicast，请暂时停用；或者使用明确把两端放进同一虚拟局域网的 VPN。
- 确认两台设备能访问 daemon 主机的 TCP `9808`。
- 检查路由器是否启用了 AP/client isolation 或访客网络隔离。
- 允许 daemon 通过主机防火墙。
- 如果配对失败，重新运行 `herdr-connect pair` 生成新的 一次性 QR secret。
- 如果 TestFlight 暂时没有可安装 build，最新替换 build 可能仍在处理或等待审核。

官方远程连接不属于当前发布范围。它仍是未来 relay/E2EE 里程碑；通过 VPN 实现同网使用是 README 中描述的非官方部署方式。
