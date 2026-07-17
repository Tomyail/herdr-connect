# Herdr Connect

[简体中文](docs/zh-CN/README.md)

Herdr Connect is an experimental, local-first companion for [Herdr](https://github.com/ogulcancelik/herdr). Its first public milestone is intentionally small: reliably discover a Herdr Connect daemon from a mobile device on the same local network.

## Try it in 5 minutes

You need a computer running [Herdr](https://github.com/ogulcancelik/herdr), an iPhone, and both devices on the same trusted Wi-Fi network. Android and remote connections are not available in this preview.

1. Confirm that Herdr is installed and has at least one Agent:

   ```sh
   herdr agent list
   ```

2. Install the **v0.1.0-preview.1 daemon**. The downloaded daemon does not require Go, Node.js, pnpm, Expo, or Xcode.

   On macOS or Linux:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/Tomyail/herdr-connect/main/install.sh | sh
   ```

   On Windows, download and extract the matching zip from [GitHub Releases](https://github.com/Tomyail/herdr-connect/releases/tag/v0.1.0-preview.1).
3. Start the daemon and keep the terminal open while using the app.

   On macOS or Linux:

   ```sh
   ~/.local/bin/herdr-connect doctor
   ~/.local/bin/herdr-connect service install
   ~/.local/bin/herdr-connect service status
   ```

   On Windows PowerShell, run these commands in the extracted folder:

   ```powershell
   .\herdr-connect.exe doctor
   .\herdr-connect.exe --source herdr demo-lan
   ```

4. On your iPhone, join the public **[Herdr Connect TestFlight beta](https://testflight.apple.com/join/ZkRzJ6rm)**, install the app, and allow Local Network access when prompted.
5. Open Herdr Connect. It should discover the daemon automatically and show your Agents. Tap an Agent to view recent output, switch focus, or send text.

If discovery does not succeed, confirm that both devices use the same Wi-Fi, temporarily disable VPNs, and check firewall or guest-network isolation settings. See the [daemon guide](docs/release/daemon.md) and [TestFlight troubleshooting guide](docs/release/ios-testflight.md) for details.

For all commands, diagnostics output, exit codes, and examples, see the [CLI guide](docs/cli.md).

> [!WARNING]
> The current LAN demo has no pairing, device authentication, or end-to-end encryption. It exposes recent terminal output and text input over unencrypted HTTP. Run it only on a trusted, controlled network, never enter secrets, and stop the daemon after testing.

## Project status

Herdr Connect is an early preview, not a production-ready remote access product.

| Area | Status |
| --- | --- |
| Bonjour/mDNS daemon advertisement | Experimental |
| iOS discovery on a physical device | Public TestFlight preview available |
| Agent list, recent output, focus, and text input | Unsafe LAN demo only |
| Android app / APK | Not published |
| Pairing, authentication, and E2EE | Not implemented |
| Relay, push notifications, and remote access | Future research |

## Current goal

The current public milestone is **LAN Discovery Preview**:

- advertise `_herdr-connect._tcp` from the Go daemon;
- discover the daemon from a mobile client on the same LAN;
- clearly represent discovering, found, denied, timeout, and unavailable states;
- provide useful diagnostics for local-network permission, VPN, multicast, firewall, and client-isolation failures;
- verify discovery on physical devices.

Discovery proves reachability only. It does not establish trust or grant permission to read or control an Agent.

## Architecture

```text
Herdr CLI
    │ command-line arguments and JSON
    ▼
Herdr Connect daemon
    │ Bonjour / mDNS + local HTTP demo
    ▼
Expo / React Native mobile client
```

Herdr runs as a separate program and must be installed independently. Herdr Connect communicates with it through its CLI rather than embedding or linking Herdr source code.

## Develop from source

The steps below are for contributors working on Herdr Connect itself. To use the downloadable preview, follow [Try it in 5 minutes](#try-it-in-5-minutes) instead.

### Development requirements

For the currently validated iOS demo:

- macOS with a working `herdr` CLI;
- Go 1.24 or later;
- Node.js 24 recommended;
- pnpm 10.28.1;
- Xcode and an iPhone physical device;
- Mac and iPhone on the same trusted Wi-Fi without client isolation;
- local-network permission enabled for the development build.

The mobile client uses a native Bonjour module and therefore requires an Expo development build. Expo Go is not sufficient.

### Source development setup

Install JavaScript dependencies:

```sh
corepack enable
pnpm install --frozen-lockfile
```

Confirm that Herdr is available and has at least one Agent:

```sh
herdr agent list
```

Start the LAN demo daemon:

```sh
pnpm demo:lan
```

The daemon listens on TCP port `9808` and advertises `_herdr-connect._tcp`.

Install the Expo development build on a connected iPhone:

```sh
pnpm ios:mobile
```

For later development sessions, start Metro with:

```sh
pnpm dev:mobile
```

Allow local-network access when iOS prompts for it. See the [controlled LAN demo guide](docs/demo/lan-ios-agent-list.md) for the full procedure, safety boundaries, acceptance checklist, and troubleshooting steps.

## Development

| Command | Purpose |
| --- | --- |
| `pnpm demo:lan` | Run the current Herdr-backed LAN demo |
| `pnpm dev:mobile` | Start the Expo development server |
| `pnpm ios:mobile` | Build and install the iOS development client |
| `pnpm typecheck` | Type-check the TypeScript packages and mobile app |
| `pnpm test:go` | Run Go tests |
| `pnpm test:ts` | Run TypeScript protocol tests |
| `pnpm test:conformance` | Run Go/TypeScript protocol conformance tests |
| `pnpm test:install` | Test the macOS/Linux installer behavior |
| `pnpm test` | Run the complete test suite |

Repository layout:

```text
apps/mobile/       Expo / React Native mobile client
cmd/               Go command entry points
internal/          Daemon, LAN demo, Herdr adapter, projection, and storage
packages/protocol/ TypeScript protocol implementation
protocol/          Go protocol implementation and test vectors
docs/              Technical and contributor documentation
```

## Roadmap

1. Reliable cross-platform LAN discovery.
2. Authenticated, read-only LAN connectivity.
3. Secure remote connectivity and notifications as a later research track.

Remote access is not part of the current release commitment. Roadmap items may change as the project learns from real usage.

## Security

Do not report vulnerabilities, credentials, private prompts, Agent output, or sensitive paths in public issues. Follow the private reporting instructions in [SECURITY.md](SECURITY.md).

Until authentication and encryption are implemented, treat `demo-lan` as an unsafe development tool for controlled environments only.

## Contributing

The project is in an early scope-setting phase. Bug reports, reproducible discovery failures, documentation fixes, and design feedback are welcome through [GitHub Issues](https://github.com/Tomyail/herdr-connect/issues).

Before submitting code, open an issue to confirm that the change belongs to the current LAN discovery milestone. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and the repository conventions in [AGENTS.md](AGENTS.md).

Community policies: [Code of Conduct](CODE_OF_CONDUCT.md), [Security Policy](SECURITY.md), and [Privacy Policy](PRIVACY.md).

## Relationship to Herdr

Herdr Connect is an independent companion project. It is not affiliated with or endorsed by the Herdr project. Herdr is installed separately and remains subject to its own license and project policies.

## License

Licensed under the [Apache License 2.0](LICENSE).
