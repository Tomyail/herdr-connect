# Issue tracker

Herdr Connect 使用 GitHub Issues 管理 spec、ticket、缺陷和维护工作。

## 位置

- GitHub：`https://github.com`
- 仓库：`Tomyail/herdr-connect`
- CLI：`gh`

## Agent 使用规则

- 读取或创建 issue 时显式指定仓库 `Tomyail/herdr-connect`。
- spec issue 使用完整 Markdown 正文，并应用 `ready-for-agent` 标签。
- 创建 issue 后必须回读标题、正文和标签，确认没有被 shell 转义或截断。
- PR 不作为默认需求入口；除非项目后续明确修改本约定，否则 triage skill 不从 PR 反推新需求。
- 不在 issue 中粘贴 token、密钥、prompt、Agent 输出或其他敏感运行数据。

## 常用命令形态

```text
gh issue list --repo Tomyail/herdr-connect
gh issue create --repo Tomyail/herdr-connect
gh issue edit <编号> --repo Tomyail/herdr-connect
```
