# Protocol v1 威胁模型

本文件描述 Herdr Connect MVP 的安全边界。它不是“使用加密所以安全”的声明，而是明确哪些攻击者被考虑、哪些资产被保护、哪些风险仍然存在。

## 保护资产

- Installation 与每台 Device 的长期私钥。
- Agent prompt、Output Snapshot 和 Remote Command 内容。
- Agent Turn 的生命周期状态与结果。
- Device 授权、撤销状态和 Remote Command 幂等记录。
- `event_seq`、ACK cursor、`command_id` 等顺序与一致性事实。

## 信任边界

### Installation 主机

daemon 与 Herdr 运行在所有者电脑上，是 Agent 内容的事实来源。daemon 可以读取受限输出并执行允许的 Remote Command，因此主机被完全攻陷后，Protocol v1 无法保护 Agent 内容。

### Device

已配对 Device 代表所有者，可读取面向自己的内容并发送固定 allowlist 中的命令。Device 丢失后必须由 Installation 本机撤销。MVP 不支持远程恢复或密钥托管。

### LAN

LAN 不可信。其他主机可以观察 mDNS、扫描端口、阻断、延迟、重放或修改流量。mDNS 只能发布 opaque 服务信息；所有业务消息仍须执行 Device 认证、签名、HPKE 和重放检查。

### Relay

官方 Cloudflare 环境和 BYO Cloudflare 都是不可信 Relay。Relay 可以观察必要路由元数据、包大小、时序、目标 Device 和连接 IP，也可以丢弃、延迟、重复或乱序密文；它不能解密 payload、伪造发送方或让过期/重放命令被接受。

### Expo Push Service

Expo、APNs 和 FCM 可以看到 PushToken、投递时间和通用通知文本。系统推送不包含 prompt、Agent 输出、项目名或具体任务内容；点击后 App 必须经 Protocol v1 获取真实状态。

## 攻击者与缓解措施

### 被动网络观察者

观察者能看到端点、流量大小和时间，但 payload 由逐 Device HPKE 加密。Protocol v1 不提供 padding，因此不能隐藏明文长度类别；这是 MVP 接受的 metadata 风险。

### 主动网络攻击者

攻击者可以修改 envelope。受保护头作为 HPKE AAD，并与 ciphertext 一起由 Ed25519 签名；修改头、`enc`、ciphertext 或 signature 都会失败。签名和 HPKE 失败统一成 `authentication_failed`，避免形成细粒度密码 oracle。

### 恶意或被攻陷的 Relay

Relay 不能分配 `event_seq` 或修改事件事实。daemon 分配顺序并签名；Device 发现 gap 后请求快照。Relay 可以造成拒绝服务，但不能让缺失事件被静默解释为完整状态。

Relay 不保存明文。Lifecycle Event 密文最多保留 24 小时，并在 Device ACK 或 Agent 关闭后尽早删除。Output Snapshot 与 Remote Command 只短暂转发，不形成历史或离线任务。

### 重放攻击者

每个 envelope 有 `message_id`。接收方只有在签名、期限和 HPKE 全部通过后才原子执行 `MarkIfNew`；已存在的 ID 返回 `replay`。Remote Command 还必须按 `command_id` 做持久幂等，使 LAN/Relay 双路径竞态最多产生一次副作用。

### 错路由与跨 Installation 攻击

Installation、sender、recipient 和 key ID 位于受保护头。调用方必须向 `Open` 提供预期 Installation、sender 与 recipient，不能只信任 envelope 自报身份。逐 Device HPKE 使发给 Device A 的 ciphertext 无法由 Device B 解密。

### 过期命令与错误时钟

每种消息有最大 TTL；Remote Command 最多 30 秒。接收方允许创建时间最多超前两分钟，但对 `expires_at_ms` 不增加宽限。命令执行层还必须从本机首次接收开始实施 30 秒上限，并禁止 daemon 离线时排队。

### 二维码截图或抢先兑换

二维码 secret 仅五分钟有效且只能使用一次。首次 `pairing_request` 在受保护头中携带候选 Device 签名公钥，并由该公钥自签名；这只证明私钥持有，不建立信任。daemon 解密后必须确认 payload 公钥与头一致、校验并原子消耗 pairing secret，再由电脑端核对 Device 名称与公钥短指纹。Installation 对包含双方密钥、secret、challenge 和决定的专用 transcript 签名，Device 用 QR 指纹锚定的 Installation 公钥验证。确认前不能领取事件、读取输出或发送命令。

### 丢失或被盗 Device

撤销后 daemon 停止为该 Device 生成新密文并拒绝其命令。撤销不能收回 Device 已经解密并显示过的内容，也不能在 Installation 离线时主动擦除丢失 Device；App 依赖平台锁屏和安全存储降低风险。

### 恶意已授权 Device

MVP 只有一个 Owner，不提供按 Device 配置 capability。任何已授权 Device 都拥有固定 allowlist：观察状态、读取按需输出、发送 prompt、确认后 interrupt。协议不能阻止所有者主动授权的 Device 滥用这些能力；撤销是主要处置方式。

### 拒绝服务与资源放大

实现必须在昂贵密码操作前检查 base64url、受保护头上限、版本、suite、路由和明显大小错误。Protocol v1 将 plaintext 限制为 256 KiB、头限制为 4096 字节。Relay 仍需按 Installation、Device 和网络信号做连接、消息、推送和命令限流。

## 私钥存储要求

### daemon

- 长期私钥不能写入普通 SQLite 表或日志。
- macOS 使用 Keychain 或仅当前用户可读的独立秘密文件；Linux 优先使用 Secret Service，否则使用权限为 `0600` 的独立文件；Windows 使用 DPAPI/Credential Manager 或当前用户 ACL 保护的秘密文件。
- SQLite 只保存 key ID、公钥、Device 状态、撤销、cursor、outbox 元数据和幂等记录。
- 崩溃报告和诊断输出必须脱敏。

### Expo App

- 长期私钥进入 Keychain/Android Keystore 支持的安全存储。
- 解密后的 Output Snapshot 仅存在 App 进程内存，不进入 AsyncStorage、SQLite、文件缓存、通知、分析或崩溃日志。
- App 后台、锁屏、离开 Agent 页面或进程终止时清理明文，并遮蔽任务切换器截图。
- `expo-crypto` 的 `getRandomValues` 可以实现协议 `RandomSource`；开发模式不得回退到 `Math.random` 生成长期密钥或 HPKE 熵。

## 密钥生命周期

- Installation 和每台 Device 分别生成独立 X25519 与 Ed25519 密钥对。
- key ID 支持将来轮换，但 MVP 不自动轮换长期密钥。
- 新 Device 从配对完成时的当前快照开始，不能获取配对前 mailbox。
- 撤销 Device 后不为其产生新 ciphertext；其他 Device 不共享群组密钥，因此无需同步轮换。
- MVP 不提供云端 escrow、助记词、恢复码或 recovery bundle。

## 明确不解决的威胁

- Installation 主机或 Device 操作系统被完全攻陷。
- 所有者主动复制、截图或外传已经解密的内容。
- 流量分析、包长、连接时间、IP 和 Device 路由 metadata。
- 量子计算攻击；MVP 使用经典 X25519/Ed25519，未来升级需要新协议版本和迁移设计。
- Expo/APNs/FCM 拒绝投递或操作系统限制后台行为。
- 社会工程诱导所有者在电脑端确认陌生 Device。

## 安全评审触发条件

出现以下变化时必须重新评审本威胁模型：

- 引入团队、多 Owner、可配置 capability 或远程设备管理。
- 保存长期 Agent 历史、云端输出或密钥恢复。
- 改变密码 suite、canonical encoding、签名顺序或重放存储语义。
- 引入非 Cloudflare Relay、Docker standalone 或第三方 push broker。
- 允许附件、文件、语音、后台命令队列或通知内回复。
