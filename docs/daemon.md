# Go daemon 本地 tracer

Issue #6 提供了第一个本地只读纵向切片。daemon 通过自己拥有的 `Herdr Source` port 读取来源快照或增量变化，把观察投影为稳定的 Connect `agent_id` 和单调 `lifecycle_revision`，并在 SQLite 中原子分配安装实例级 `event_seq`。

## 开发命令

运行内置 fake provider 的常驻 daemon：

```sh
pnpm dev:daemon
```

运行一次完整结构化生命周期 tracer（`working → blocked → ready_input → succeeded`）：

```sh
pnpm trace:daemon
```

也可以直接使用 Go CLI：

```sh
go run ./cmd/herdr-connect --source fake --db /tmp/herdr-connect.db trace
go run ./cmd/herdr-connect --source herdr status
go run ./cmd/herdr-connect --source herdr agents
go run ./cmd/herdr-connect --source herdr capabilities
go run ./cmd/herdr-connect --source herdr diagnostics
go run ./cmd/herdr-connect --source herdr doctor
go run ./cmd/herdr-connect migrations
```

`doctor` 面向普通安装诊断，默认检查数据库、Herdr 来源、Agent 数和 LAN preview 的 TCP `9808`，再提供可执行的下一步；兼容脚本继续使用默认输出为 JSON 的 `diagnostics`。`status` 同时显示来源在线状态、能力矩阵、当前 Agent 投影和 `through_event_seq`。`daemon --once` 可用于脚本化健康检查；不带 `--once` 时每两秒重新取得公开快照，并在 Herdr 暂时不可用时继续低频重试。完整公开用法见英文 canonical [CLI 指南](cli.md)及其[中文翻译](zh-CN/cli.md)。

根目录的 fake 开发命令使用被 Git 忽略的 `.data/fake-daemon.db`，不会污染默认的真实安装实例数据库。

## 当前 Herdr 兼容边界

当前兼容适配器只调用 Herdr v0.7 的公开 `herdr agent list` JSON 命令。它使用 `terminal_id` 作为稳定来源身份，并消费来源 `revision` 来拒绝重复或乱序观察。

Herdr 返回的 `agent_status` 可能来自 screen detector，因此适配器不会把 `done`、`idle`、焦点、终端文字或进程状态映射为可信事实。所有 Agent 的 `interaction_state` 都保守表示为 `unknown`，`turn_outcome` 保持缺省；`send_prompt` 和 `interrupt` 能力明确关闭。fake provider 才声明完整结构化生命周期和能力矩阵，用作 daemon contract 的规范 provider。

## 本地持久状态与隐私

默认数据库位于当前所有者配置目录的 `herdr-connect/daemon.db`，也可用 `--db` 覆盖。SQLite driver 不依赖 CGO。daemon 会把数据库及其 sidecar 权限收紧为仅当前所有者可读写，并在启动迁移后执行 `quick_check`，拒绝继续使用损坏或更高 schema version 的数据库。schema v1 包含：

- 安装实例级事件序列和来源 cursor；
- 稳定来源身份映射与当前 Agent 投影；
- durable outbox 元数据；
- 后续命令去重、设备记录和逐设备 ACK cursor 的入口。

数据库和日志不保存 prompt、Agent 输出、已解密 payload、token 或私钥。安装实例私钥管理、设备配对和远程传输属于后续 ticket，不在这个 tracer 中生成或保存。

一个来源快照或增量批次中的 Agent 投影、durable outbox、`event_seq` 和来源 cursor 在同一 SQLite 事务中提交。批次失败或进程在提交前退出时会整体回滚；重试不会制造重复的逻辑事实。
