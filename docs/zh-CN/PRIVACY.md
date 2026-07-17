# 隐私政策

最后更新：2026 年 7 月 17 日

Herdr Connect 是一个开源配套应用，用于发现并连接同一局域网内的 Herdr daemon。

## 应用处理的数据

Herdr Connect 可能临时处理并展示由你控制的 daemon 提供的信息，包括安装实例信息、Agent 状态与活动历史，以及你主动发送的消息。这些信息仅在你的设备与局域网内的 daemon 之间直接交换。

## 数据收集

Herdr Connect 项目不运营账号系统或云服务，也不会有意收集、出售或共享个人数据。当前 MVP 不会把本地 daemon 数据发送到项目维护者运营的服务器。

通过 TestFlight 安装测试版本时，Apple 可能依据其隐私政策和 TestFlight 条款收集诊断信息、崩溃报告与反馈。

## 局域网访问

应用会请求“本地网络”权限，以发现 Bonjour 服务 `_herdr-connect._tcp` 并连接网络中的 daemon。你可以在 iOS 设置中撤销该权限。

## 安全

当前 MVP 仅面向可信局域网，不提供远程连接。你需要自行负责所连接的 daemon 与网络环境。

## 政策变更

本政策可能随着 Herdr Connect 的演进而更新。重要变更会发布在本仓库中。

## 联系方式

如有隐私问题或请求，请通过项目的 GitHub Issues 页面联系：

https://github.com/Tomyail/herdr-connect/issues
