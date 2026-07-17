# 为 Herdr Connect 做贡献

[English](../../CONTRIBUTING.md)

感谢你帮助 Herdr Connect 提升局域网发现与连接的可靠性。项目仍处于早期预览阶段，因此把改动保持在当前里程碑内，与实现质量同样重要。

## 理解你的改动

你必须能够解释改动做了什么、在重要边界条件下如何表现，以及它如何符合现有产品和领域模型。项目欢迎 AI 辅助开发，但生成的代码、诊断或文字不能替代贡献者自身的理解和验证。报告应事实明确、简洁，Pull Request 应保持在能够可靠评审的小范围内。

## 开始之前

- 阅读[项目说明](README.md)、[安全政策](SECURITY.md)和 [AGENTS.md](../../AGENTS.md) 中的仓库约定。
- 创建新 Issue 前先搜索[现有 Issues](https://github.com/Tomyail/herdr-connect/issues)。
- 对代码或行为的修改，请先创建或回复 Issue，让维护者确认该工作属于当前 LAN discovery 里程碑。
- 不要在公开 Issue、日志、截图或 Pull Request 中包含凭据、私有 prompt、Agent 输出、敏感路径或漏洞细节。

MVP 的第一目标是同一局域网内的发现与连接。配对、认证、加密、Relay、通知和远程连接需要单独设计，不能由局域网功能需求隐含引入。

## 报告缺陷

使用[缺陷报告表单](https://github.com/Tomyail/herdr-connect/issues/new?template=bug_report.yml)。请提供平台、App 与 daemon 版本、网络拓扑、预期结果、实际结果和最小复现步骤，并删除所有敏感信息。

安全漏洞必须按照[安全政策](SECURITY.md)私密报告，不要提交到公开 Issue tracker。

## 提议改动

使用[功能建议表单](https://github.com/Tomyail/herdr-connect/issues/new?template=feature_request.yml)。请说明用户问题以及它为何符合 LAN 里程碑。维护者可能把范围更广的远程连接工作推迟到后续路线图。

## 开发环境

仓库需要 Go 1.24 或更高版本、推荐 Node.js 24，以及 pnpm 10.28.1。iOS 工作需要 Xcode 和 iPhone 真机；Expo Go 不能代替原生 development build。

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm test
```

各类专项检查参见 [README](README.md#开发)。

## Pull Request

- 保持 PR 聚焦，并关联相关 Issue。
- 能够解释改动、边界情况，以及它为何符合现有设计。
- 说明面向用户的行为、安全影响和验证方式。
- 行为变化时补充或更新测试与公开文档。
- 公开文档以英语为 canonical，并同步更新 `docs/zh-CN/` 下的对应内容。
- 不要把无关重构混入功能改动。
- 确认 diff 中没有秘密或私有 Agent 数据。

参与本项目即表示你同意遵守[行为准则](CODE_OF_CONDUCT.md)。
