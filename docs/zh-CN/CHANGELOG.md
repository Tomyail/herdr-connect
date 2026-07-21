# 更新日志

本文档记录 Herdr Connect 面向用户的重要变更。英文版 [`CHANGELOG.md`](../../CHANGELOG.md) 为 canonical 文档，本文件为简体中文翻译。

## [0.1.0-preview.4] - 2026-07-20

### 新增

- 增加安全的配对流程：用摄像头扫描 daemon 的二维码，输入设备名称，App 即通过 TLS 指纹 pinning 建立互信。
- 增加 TLS 指纹 pinning，所有发往局域网 daemon 的 HTTPS 请求均通过本地 Expo 模块（`pinned-fetch`）以常量时间验证 daemon 自签名证书指纹。
- 在 agent 详情页增加中断按钮，可从手机端停止正在运行的 agent 回合，发送中断前先弹出确认对话框。
- 新增基于 Server-Sent Events（SSE）的实时 agent 状态更新，agent 列表中显示「Live」/「Polling」指示器。
- 新增前台本地通知（含触觉反馈），当 agent 等待用户输入时弹出通知横幅，确保即使 App 在前台也不会错过 agent 的提问。
- 在 agent 历史记录中增加行内 Markdown 渲染（粗体、行内代码、标题），同时保留终端工具输出的行结构。
- 增加设备撤销处理：当 daemon 撤销已配对设备时，App 显示清晰的「设备已被撤销」提示并清除本地凭据，确保重新配对从干净状态开始。

### 修复

- 提升 Bonjour 发现可靠性，使 daemon 在局域网中被更稳定地发现。
- 修复通知权限仅在用户手动切换通知开关时才被请求的问题；现在当设置已开启时，App 启动后自动请求权限。
- 从 agent 历史记录中剥离 TUI 的边框、提示符和状态行，使移动端展示干净的 agent 输出而非终端界面框架。

### 变更

- 演示 API 已正式升级为 `/v1/agents`，并加入双向版本校验；当 daemon 或客户端版本过旧时，会显示明确的升级提示而非模糊的错误。

### 发布工具

- 已将 iOS TestFlight build `0.1.0 (4)` 上传至 App Store Connect。

[0.1.0-preview.4]: https://github.com/Tomyail/herdr-connect/compare/v0.1.0-preview.3...v0.1.0-preview.4
[0.1.0-preview.3]: https://github.com/Tomyail/herdr-connect/compare/v0.1.0-preview.2...v0.1.0-preview.3
