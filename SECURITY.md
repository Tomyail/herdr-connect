# Security Policy

[简体中文](docs/zh-CN/SECURITY.md)

## Supported versions

Herdr Connect is an experimental preview. Only the latest published preview is considered for security fixes; no version currently carries a production security guarantee.

| Version | Supported |
| --- | --- |
| `v0.1.0-preview.1` | Best-effort fixes |
| Older or unreleased builds | No |

## Report a vulnerability

Do not disclose vulnerabilities in public issues, discussions, pull requests, logs, or screenshots. Do not include credentials, private prompts, Agent output, sensitive paths, or other people's data.

Use GitHub's [private vulnerability reporting form](https://github.com/Tomyail/herdr-connect/security/advisories/new). Include:

- affected version, platform, and component;
- impact and realistic attack conditions;
- minimal reproduction steps or a proof of concept;
- suggested mitigation, if known.

If private vulnerability reporting is unavailable, open a public issue that only asks the maintainers to establish a private contact channel. Do not include vulnerability details in that issue.

Maintainers will acknowledge a private report as capacity allows, validate it, coordinate a fix and disclosure timeline, and credit the reporter if requested and appropriate. This volunteer project cannot promise a fixed response or remediation deadline.

## Preview security boundary

The current LAN demo has no pairing, device authentication, or end-to-end encryption. It sends recent terminal output and text input over unencrypted HTTP. Use it only on a trusted, controlled local network; never enter secrets; stop the daemon after testing.

Remote connectivity is not implemented. It is a later TODO and must not be inferred from the current LAN discovery preview.
