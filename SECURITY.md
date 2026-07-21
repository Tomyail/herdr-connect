# Security Policy

[简体中文](docs/zh-CN/SECURITY.md)

## Supported versions

Security fixes are considered for the latest published Herdr Connect build. Older or unreleased builds are not supported.

| Version | Supported |
| --- | --- |
| `v0.1.0-preview.2` | Best-effort fixes |
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

## LAN security boundary

Herdr Connect's current product scope is LAN-only. The daemon serves an HTTPS LAN API with a self-signed ECDSA P-256 certificate pinned by SHA-256 fingerprint, one-time QR pairing, per-device bearer tokens, local revocation, and rate limiting. Keep the daemon on networks or VPNs you operate, and do not expose TCP `9808` directly to the public internet.

This is connection-layer security for same-LAN use. Message-layer E2EE and official remote relay connectivity are future milestones; see [LAN TLS and pairing](docs/security/lan-tls-pairing.md) and the Protocol v1 documents for the current model and roadmap.
