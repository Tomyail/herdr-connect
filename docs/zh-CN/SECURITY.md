# 安全政策

[English](../../SECURITY.md)

## 支持的版本

维护者会考虑为最新公开发布的 Herdr Connect build 提供安全修复。更旧或未发布的 build 不受支持。

| 版本 | 支持情况 |
| --- | --- |
| `v0.1.0-preview.2` | 尽力修复 |
| 更旧或未发布的 build | 不支持 |

## 报告漏洞

不要在公开 Issue、Discussion、Pull Request、日志或截图中披露漏洞。不要包含凭据、私有 prompt、Agent 输出、敏感路径或他人数据。

请使用 GitHub 的[私密漏洞报告表单](https://github.com/Tomyail/herdr-connect/security/advisories/new)，并提供：

- 受影响的版本、平台和组件；
- 影响与现实攻击条件；
- 最小复现步骤或 proof of concept；
- 已知的缓解建议（如有）。

如果私密漏洞报告不可用，请只创建一个请求维护者建立私密联系渠道的公开 Issue，不要在该 Issue 中写入漏洞细节。

维护者会在精力允许时确认私密报告、进行验证、协调修复与披露时间，并在报告者希望且条件适当时致谢。本项目由志愿者维护，无法承诺固定的响应或修复期限。

## LAN 安全边界

Herdr Connect 当前产品范围是 LAN-only。daemon 提供 HTTPS LAN API，使用自签 ECDSA P-256 证书的 SHA-256 指纹 pinning、一次性 QR 配对、每设备 bearer token、本地撤销和限流。请把 daemon 放在你管理的网络或 VPN 中，不要把 TCP `9808` 直接暴露到公网。

这是面向同一局域网使用的连接层安全。消息层 E2EE 与官方远程 relay 连接是未来里程碑；当前模型和路线见 [LAN TLS 与配对](../security/lan-tls-pairing.md) 以及 Protocol v1 文档。
