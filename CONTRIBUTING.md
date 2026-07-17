# Contributing to Herdr Connect

[简体中文](docs/zh-CN/CONTRIBUTING.md)

Thank you for helping Herdr Connect make local discovery and connection reliable. The project is an early preview, so keeping changes inside the current milestone matters as much as implementation quality.

## Understand your change

You must be able to explain what your change does, how it behaves at important edges, and how it fits the existing product and domain model. AI-assisted development is welcome, but generated code, diagnosis, or prose is not a substitute for contributor understanding and verification. Keep reports factual and concise, and keep pull requests small enough to review confidently.

## Before you start

- Read the [README](README.md), [security policy](SECURITY.md), and repository conventions in [AGENTS.md](AGENTS.md).
- Search [existing issues](https://github.com/Tomyail/herdr-connect/issues) before opening a new one.
- For code or behavior changes, open or comment on an issue first so maintainers can confirm that the work belongs to the current LAN discovery milestone.
- Do not include credentials, private prompts, Agent output, sensitive paths, or vulnerability details in public issues, logs, screenshots, or pull requests.

The MVP's first goal is discovery and connection on the same local network. Pairing, authentication, encryption, relay services, notifications, and remote access require separate design work and are not implied by a LAN feature request.

## Report a bug

Use the [bug report form](https://github.com/Tomyail/herdr-connect/issues/new?template=bug_report.yml). Include the platform, app and daemon versions, network topology, expected result, actual result, and minimal reproduction steps. Redact all sensitive data.

Security vulnerabilities must follow [SECURITY.md](SECURITY.md), not the public issue tracker.

## Propose a change

Use the [feature request form](https://github.com/Tomyail/herdr-connect/issues/new?template=feature_request.yml). Explain the user problem and why it fits the LAN milestone. Maintainers may defer broader remote-access work to the roadmap.

## Development setup

The repository requires Go 1.24 or later, Node.js 24 recommended, and pnpm 10.28.1. For iOS work, use Xcode and a physical iPhone; Expo Go cannot replace the native development build.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm test
```

Useful focused checks are documented in the [README](README.md#development).

## Pull requests

- Keep the pull request focused and link the relevant issue.
- Be prepared to explain the change, its edge cases, and its fit with the existing design.
- Explain user-visible behavior, safety implications, and how the change was verified.
- Add or update tests and public documentation when behavior changes.
- Keep English public documentation canonical and update the matching content under `docs/zh-CN/`.
- Do not mix unrelated refactors with a functional change.
- Confirm that no secrets or private Agent data appear in the diff.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
