# 更新日志

本文档记录 Herdr Connect 面向用户的重要变更。英文版 [`CHANGELOG.md`](../../CHANGELOG.md) 为 canonical 文档，本文件为简体中文翻译。

## [0.1.0-preview.3] - 2026-07-19

### 新增

- 为移动端 App 增加英文和简体中文本地化。
- 增加浅色与深色外观、设置页签以及侧滑式 agent 详情。
- 增加 agent 品牌图标、更清晰的状态展示，以及详情页中常驻的 agent 切换栏。
- agent 完成任务时播放提示音。

### 修复

- 内容更新时保留历史记录滚动位置，并在内容未变化时避免不必要的历史刷新。
- 修复完成状态检测，使完成提示音能够可靠播放。
- 修正设置项的交互样式。

### 发布工具

- 已将 iOS TestFlight build `0.1.0 (3)` 上传至 App Store Connect；尚待分发给测试用户。
- IPA 导出时向 Xcode 传递 App Store Connect API 凭据，使自动签名能够刷新 provisioning profile。

[0.1.0-preview.3]: https://github.com/Tomyail/herdr-connect/compare/v0.1.0-preview.2...v0.1.0-preview.3
