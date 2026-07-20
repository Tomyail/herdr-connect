# Herdr Connect

[简体中文](docs/zh-CN/README.md)

## Demo

[![Herdr Connect — LAN Discovery Demo](https://img.youtube.com/vi/BxX4ijalnzI/maxresdefault.jpg)](https://youtu.be/BxX4ijalnzI)

Watch an iPhone discover the Herdr Connect daemon over local Wi-Fi and show the Agent list. See [Try it in 5 minutes](#try-it-in-5-minutes) to reproduce it yourself.

<p>
  <img src="assets/screenshot-1.png" alt="Herdr Connect iOS screenshot" width="180" />
  <img src="assets/screenshot-2.png" alt="Herdr Connect iOS screenshot" width="180" />
</p>

Herdr Connect is an experimental, local-first companion for [Herdr](https://github.com/ogulcancelik/herdr). Its first public milestone is intentionally small: reliably discover a Herdr Connect daemon from a mobile device on the same local network.

## Try it in 5 minutes

You need a computer running [Herdr](https://github.com/ogulcancelik/herdr), an iPhone, and both devices on the same trusted Wi-Fi network. Android and remote connections are not available in this preview.

1. Confirm that Herdr is installed and has at least one Agent:

   ```sh
   herdr agent list
   ```

2. Install the **v0.1.0-preview.2 daemon**. The downloaded daemon does not require Go, Node.js, pnpm, Expo, or Xcode.

   On macOS or Linux:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/Tomyail/herdr-connect/main/install.sh | sh
   ```

   On Windows, download and extract the matching zip from [GitHub Releases](https://github.com/Tomyail/herdr-connect/releases/tag/v0.1.0-preview.2).
3. Check and start the daemon. The macOS/Linux service continues in the background; Windows users keep the foreground terminal open while using the app.

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

## Documentation

| Audience | Start here |
| --- | --- |
| Try the preview | [Try it in 5 minutes](#try-it-in-5-minutes), [daemon guide](docs/release/daemon.md), [TestFlight troubleshooting](docs/release/ios-testflight.md) |
| CLI reference | [CLI guide](docs/cli.md) |
| Architecture, domain, and contributor deep dives | [OpenWiki](openwiki/quickstart.md) |
| Controlled LAN demo procedure | [LAN iOS demo guide](docs/demo/lan-ios-agent-list.md) |

OpenWiki is the living code-oriented wiki (architecture, adapters, projection, protocol notes, development setup, and testing). Prefer it over duplicating those details here.

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

For component responsibilities, data flow, and source maps, see the [architecture overview](openwiki/architecture/overview.md).

## Develop from source

Contributor setup, repository layout, common `pnpm` commands, and the full development workflow live in OpenWiki:

- [Development setup](openwiki/development/setup.md)
- [Testing guide](openwiki/development/testing.md)

For users who only want the downloadable preview, follow [Try it in 5 minutes](#try-it-in-5-minutes) instead.

Minimal path after cloning:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm demo:lan      # daemon on TCP 9808, advertises _herdr-connect._tcp
pnpm ios:mobile    # Expo development build on a physical iPhone
pnpm dev:mobile    # later sessions: Metro only
```

The mobile client needs a native Bonjour module, so use an Expo development build rather than Expo Go. Safety boundaries and acceptance checks for the controlled demo are in the [LAN iOS demo guide](docs/demo/lan-ios-agent-list.md).

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
