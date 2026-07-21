# 局域网 iOS Agent 详情与输入最小演示

> **Archived / 已归档**: this document describes the pre-pairing, unauthenticated LAN demo procedure superseded by issue #21. It is kept only as historical context. See [LAN TLS and pairing](../security/lan-tls-pairing.md) for the current security model.
>
> **已归档**：本文描述的是 issue #21 之前、尚未配对且无认证的局域网 demo 流程，仅作为历史背景保留。当前安全模型见 [LAN TLS 与配对](../security/lan-tls-pairing.md)。

## 演示定位与安全边界

这是为明日演示准备的**受控局域网 demo**，不是安全 MVP，也不能代表首个正式版本的安全设计已经完成。

本 demo **没有配对、没有设备认证、没有端到端加密（E2EE）**。同一网络中的其他参与者可能发现服务、访问或干扰演示流量，因此：

- 只允许在参与者和设备均可控的局域网内运行；
- 禁止在公共 Wi-Fi、访客网络、酒店/会场网络或其他不可信网络运行；
- 演示结束后立即停止 daemon；
- 不要使用含敏感项目名、路径或工作内容的真实 Agent 做演示。
- 近期终端文本和手机输入均以未加密 HTTP 在局域网传输；不得输入凭据、token 或其他秘密。

正式产品要求“同一局域网本身不构成授权”；本 demo 为验证最短可见链路而临时绕过该要求，不能据此放宽后续的配对、认证或加密要求。

## 本次范围

唯一演示链路是：

```text
Herdr `agent list` / `agent read` / `pane run` ↔ Go daemon ↔ iOS Agent 详情
```

本次只验证：Go daemon 能通过 Herdr Source Adapter 读取 Agent 列表与范围受限的近期终端文本，在局域网让 iOS 真机发现服务；点击 Agent 后切换电脑端焦点、进入详情页，并把一条文本输入提交给对应 Agent pane。

以下内容明确不做，也不应在演示中暗示已经支持：

- 结构化完整对话历史；
- 超出近期 120 行的完整终端历史；
- 中断 Agent；
- 除切换可见焦点与发送一条文本外的其他远程控制；
- Relay；
- 推送通知；
- iOS 后台发现、后台连接或其他后台服务；
- Android；
- 跨平台安装、打包或分发。

## 演示前准备

- 一台运行 Herdr 与 Go daemon 的 Mac；
- 一台 iPhone 真机；模拟器可以辅助开发，但不能作为本次验收设备；
- Mac 与 iPhone 连接同一个受控 Wi-Fi，且网络没有启用客户端隔离；
- Mac 上的 `herdr` CLI 可用，`herdr agent list` 能返回当前 Agent；
- iOS App 使用 Expo development build，并通过 Xcode 构建或安装到真机；不能只依赖 Expo Go；
- iPhone 已允许该 App 使用“本地网络”权限；
- macOS 防火墙允许本次 daemon 进程接受局域网连接。

## 启动命令

在仓库根目录启动 LAN demo：

```sh
pnpm demo:lan
```

该命令展开为 `go run ./cmd/herdr-connect --source herdr demo-lan`。daemon 默认监听 TCP `9808`，广播 `_herdr-connect._tcp`，提供 Agent 快照、近期历史、焦点切换和文本发送接口。启动时出现“无认证、无加密、仅用于受控局域网演示”警告是预期行为。

首次把 Expo development build 安装到已连接的 iPhone：

```sh
pnpm ios:mobile
```

安装完成后，日常启动 Metro：

```sh
pnpm dev:mobile
```

首次启动或首次发现局域网服务时，在系统提示中允许“本地网络”访问。这个客户端包含原生 Bonjour 模块，不能使用 Expo Go 代替 development build。

development build 首先使用 Bonjour 发现 daemon。如果现场 Wi-Fi、VPN 或 iOS beta 环境阻断 mDNS multicast，等待六秒后会尝试连接 Metro bundle 所在开发机的 TCP `9808`，作为本次演示专用兜底。该路径只适用于 Metro 与 daemon 运行在同一台 Mac 的开发演示，不属于正式产品的发现协议。

## 5 分钟演示脚本

### 0:00–1:00：确认受控环境

1. 明确口头说明：这是没有配对、认证和 E2EE 的受控 LAN demo，不得用于公共或不可信网络。
2. 展示 Mac 与 iPhone 已连接同一个受控 Wi-Fi。
3. 确认演示使用 iPhone 真机，而不是只在模拟器中运行。

### 1:00–2:00：确认 Herdr 来源

1. 在 Mac 上确认 `herdr` CLI 可执行。
2. 运行 `herdr agent list`，确认至少存在一个适合公开演示的 Agent，并记住其可辨认的基本信息。
3. 若列表为空，先在 Herdr 中准备一个演示 Agent，再继续。

### 2:00–3:00：启动 Go daemon

1. 在仓库根目录运行上面的 `demo-lan` 命令。
2. 保持终端可见，确认进程没有立即退出或持续报错。
3. 不添加本文未记录且实现未通过 `--help` 暴露的参数。

### 3:00–4:30：iOS 发现并展示

1. 在 iPhone 上打开 Expo development build。
2. 如系统询问，允许 App 使用“本地网络”。
3. 等待 Bonjour/mDNS 发现 daemon。
4. 打开 Agent 列表，确认页面展示来自 Herdr 的 Agent 基本信息，并与刚才的 `herdr agent list` 对照。
5. 点击其中一个 Agent，确认 iOS 显示“已切换”，电脑端 Herdr 聚焦到对应 Agent。
6. 在详情页确认顶部显示近期历史，在底部输入一条不含秘密的演示文本并发送。
7. 确认电脑端对应 Agent 收到文本，iOS 历史区随后刷新。

### 4:30–5:00：收尾与再次声明边界

1. 指出本次只证明范围受限的读取、焦点切换和文本提交可用，不证明安全 MVP、结构化对话、后台可靠性或通用远程控制能力。
2. 停止 daemon，结束局域网暴露。

## 成功标准

以下条件必须全部满足：

- [ ] 演示者已明确说明本 demo 无配对、无认证、无 E2EE，且只在受控局域网运行；
- [ ] Mac 与 iPhone 真机位于同一个无客户端隔离的 Wi-Fi；
- [ ] `herdr agent list` 可用，并能看到至少一个演示 Agent；
- [ ] Go daemon 的 `demo-lan` 启动后保持运行，没有阻断演示的错误；
- [ ] iOS App 获得“本地网络”权限，并通过 Bonjour/mDNS 发现 daemon；
- [ ] iOS Agent 列表能展示与 Herdr 来源相符的 Agent 基本信息；
- [ ] 点击 Agent 后电脑端 Herdr 能切换到对应 Agent；
- [ ] 详情页能显示近期 120 行以内的终端文本，并能从底部输入框提交一条演示文本；
- [ ] 演示没有展示或声称支持结构化完整对话、完整终端历史、中断、其他远程控制、Relay、推送、后台服务、Android 或跨平台安装；
- [ ] 演示结束后已停止 daemon。

## 失败排查

按以下顺序排查，避免同时改变多个条件。

### 1. Herdr CLI 是否可用

- 在同一个终端直接运行 `herdr agent list`；如果命令不存在、返回错误或列表为空，先修复 Herdr 环境。
- 确认 daemon 进程继承的 `PATH` 能找到同一个 `herdr` 可执行文件。
- 当前 Herdr Source Adapter 只保守读取 Agent；不要把来源中的 `done`、`idle` 或终端内容解释为可信的交互状态或轮次结果。

### 2. 是否使用 iPhone 真机

- 本次验收必须使用真机。模拟器的网络发现行为不能替代真机验收。
- 确认真机安装并运行的是当前 Expo development build，而不是只在 Expo Go 或旧 build 中查看。

### 3. iOS“本地网络”权限

- 在 iPhone 的系统设置中检查该 App 的“本地网络”权限是否开启。
- 如果曾拒绝权限，开启后完全退出并重新打开 App，再重新触发发现。
- 如果设置中没有对应项，确认 development build 已包含实现要求的本地网络与 Bonjour 配置，然后重新构建安装；不要用运行时猜测的服务类型代替构建配置。

### 4. Bonjour/mDNS 发现

- 确认 Mac 与 iPhone 在同一 Wi-Fi，且没有使用访客网络、客户端隔离、VPN 或会阻断本地发现的网络策略。
- 先确认 daemon 仍在运行，再查看 daemon 与 iOS 的可见日志中是否分别出现服务发布和发现结果。
- daemon 与 development build 都必须使用 `_herdr-connect._tcp`。
- 需要用 macOS 的 `dns-sd` 辅助检查时，可运行 `dns-sd -B _herdr-connect._tcp local.`。
- 如果真机没有收到 Bonjour 事件但 development build 仍能加载 Metro，保持 Metro 与 daemon 在同一台 Mac 运行；客户端会在六秒后走开发机地址兜底。

### 5. macOS 防火墙

- 检查 macOS 是否阻止 Go 构建出的临时 daemon 或最终 `herdr-connect` 可执行文件接受传入连接。
- 只为本次受控演示所用的实际进程放行；修改后重启 daemon，再让 iOS 重新发现。
- 不要为了演示把 Mac 暴露到公共或不可信网络。

### 6. 已发现但列表或详情不正确

- 再次运行 `herdr agent list`，确认 Herdr 来源仍在线且列表不是空的。
- 对照 daemon 日志，区分“来源读取失败”“局域网请求失败”和“iOS 渲染失败”。
- 详情历史是 `recent-unwrapped` 的近期终端截面，不是结构化消息记录；不得按完整对话验收。
- 发送失败时先用 `herdr agent get <terminal_id>` 确认 Agent 仍存在，再确认对应 pane 能接受 `pane run`。

## 最终校准清单

合入演示实现后，主 agent 应在开演前完成一次校准：

- [ ] `pnpm demo:lan` 能启动 `demo-lan` 并监听 TCP `9808`；
- [ ] 本文启动命令的参数顺序与实际 CLI 一致；
- [ ] iOS development build 的启动入口与现场操作一致；
- [ ] Bonjour 服务类型和 iOS 构建配置均为 `_herdr-connect._tcp`；
- [ ] iOS 实际展示的“Agent 基本信息”与成功标准措辞一致；
- [ ] 现场至少完成一次 Mac 与 iPhone 真机、同一 Wi-Fi 的全链路预演。
