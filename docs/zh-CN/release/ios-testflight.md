# 安装 iOS TestFlight 预览版

[English](../../../docs/release/ios-testflight.md)

iOS 预览版通过 Apple TestFlight 分发：

**[加入 Herdr Connect TestFlight 测试](https://testflight.apple.com/join/ZkRzJ6rm)**

公开测试已经通过 Beta App Review 并向测试者开放。后续替换 build 在 Apple 处理或审核期间仍可能短暂不可用。

## 安装前准备

- 在 iPhone 上安装 Apple TestFlight App。
- 在电脑上安装并启动 [v0.1.0-preview.1 daemon](daemon.md)。
- 确保 iPhone 与 daemon 主机位于同一个可信 Wi-Fi，且没有客户端隔离。
- 确保 VPN 与防火墙没有阻止本地 multicast 或 TCP `9808`。

## 在局域网连接

1. 在 iPhone 上打开 TestFlight 邀请并安装 Herdr Connect。
2. 使用 `herdr-connect --source herdr demo-lan` 启动 daemon。
3. 打开 Herdr Connect，并在 iOS 请求时允许“本地网络”访问。
4. 等待 App 在同一局域网中发现 `_herdr-connect._tcp`。

当前 demo 通过未加密的本地 HTTP 传输近期终端输出和文本输入，没有配对、认证或端到端加密。只能在你控制的网络和设备上测试，不得输入秘密，并在结束后停止 daemon。

## 故障排查

- 在 iOS 设置中确认 Herdr Connect 已获得“本地网络”权限。
- 暂时停用 VPN，并确认两个设备连接同一个 Wi-Fi。
- 检查路由器是否启用了 AP/client isolation 或访客网络隔离。
- 允许 daemon 通过主机防火墙，并确认 TCP `9808` 在局域网内可达。
- 如果 TestFlight 暂时没有可安装 build，最新替换 build 可能仍在处理或等待审核。

远程连接不属于当前预览版。项目会先实现可靠、安全的局域网发现与连接，远程能力仍是后续 TODO。
