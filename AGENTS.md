# Herdr Connect 协作约定

## 文档语言

- 面向公开用户的文档以英语版本为 canonical，包括根目录 README、安装与发布说明、隐私与安全政策、贡献指南和社区健康文件；对应的简体中文入口或翻译放在 `docs/zh-CN/`。
- 修改公开用户文档时，应同步维护相关中文翻译，或明确标注中文内容尚待更新。不要把中文翻译作为英文 canonical 文档的唯一信息来源。
- 内部设计文档、领域语言、ADR、spec、计划、评审和交接文档可以继续使用简体中文；不要求为符合公开文档策略而机械翻译历史内部文档。
- 为保证协议和代码的一致性，代码标识符、协议字段、枚举值、命令、文件名以及没有准确中文译名的专有名词可以保留英文，但其含义和取舍应使用该文档对应的主要语言说明。

## Agent skills

### Issue tracker

项目使用 `github.com/Tomyail/herdr-connect` 的 GitHub Issues，通过 `gh` CLI 读写。详见 `docs/agents/issue-tracker.md`。

### Triage labels

项目使用五个默认 triage 角色标签。详见 `docs/agents/triage-labels.md`。

### Domain docs

项目采用 single-context 领域文档布局，统一领域语言记录在根目录 `CONTEXT.md`。详见 `docs/agents/domain.md`。
