# Install the daemon

[简体中文](https://github.com/Tomyail/herdr-connect/blob/main/docs/zh-CN/release/daemon.md)

Herdr Connect provides precompiled daemon archives for macOS, Linux, and Windows. The current public build is [v0.1.0-preview.2](https://github.com/Tomyail/herdr-connect/releases/tag/v0.1.0-preview.2). The daemon is the owner-side LAN service: it talks to the local Herdr CLI, advertises `_herdr-connect._tcp`, serves the HTTPS LAN API, and stores pairing/device state on the host.

## Quick install on macOS or Linux

Install the current daemon to `~/.local/bin/herdr-connect`:

```sh
curl -fsSL https://raw.githubusercontent.com/Tomyail/herdr-connect/main/install.sh | sh
```

The installer detects Apple Silicon, Intel/AMD64, and Linux ARM64. It downloads the pinned release archive and verifies it against the release's `SHA256SUMS` before installing the binary. It does not use `sudo`.

To inspect the script before running it:

```sh
curl -fsSL https://raw.githubusercontent.com/Tomyail/herdr-connect/main/install.sh -o install.sh
less install.sh
sh install.sh
```

Override the version or installation directory when needed:

```sh
curl -fsSL https://raw.githubusercontent.com/Tomyail/herdr-connect/main/install.sh \
  | HERDR_CONNECT_VERSION=v0.1.0-preview.2 HERDR_CONNECT_INSTALL_DIR="$HOME/bin" sh
```

Windows users should continue with the zip download below.

## Choose a download

Download the archive matching your computer:

| Platform | Architecture | Asset suffix |
| --- | --- | --- |
| macOS | Apple Silicon | `darwin_arm64.tar.gz` |
| macOS | Intel | `darwin_amd64.tar.gz` |
| Linux | ARM64 | `linux_arm64.tar.gz` |
| Linux | x86-64 | `linux_amd64.tar.gz` |
| Windows | x86-64 | `windows_amd64.zip` |

The release also includes `SHA256SUMS`. The daemon archives do not require Go, Node.js, pnpm, or Expo.

## Verify and run

If you used the installer, confirm that Herdr is available and start the daemon with:

```sh
herdr agent list
~/.local/bin/herdr-connect doctor
~/.local/bin/herdr-connect service install
~/.local/bin/herdr-connect service status
```

The service runs as the current owner: a LaunchAgent on macOS or a systemd user service on Linux. Use `service logs`, `service logs --tail`, `service restart`, and `service uninstall` to manage its lifecycle. Uninstalling the service preserves the binary, database, logs, certificates, and paired-device records.

For a manually downloaded archive, extract it. On macOS or Linux, make the binary executable if necessary and inspect its capabilities:

```sh
chmod +x herdr-connect
./herdr-connect --source fake capabilities
```

Confirm that the separately installed `herdr` CLI is available, then start the LAN service:

```sh
herdr agent list
./herdr-connect doctor
./herdr-connect service install
./herdr-connect service status
```

On Windows, run `herdr-connect.exe` from PowerShell or Command Prompt. Windows service management is not available yet; keep a foreground `demo-lan` process running while you use the app:

```powershell
.\herdr-connect.exe doctor
.\herdr-connect.exe --source herdr demo-lan
```

## Pair a phone

Once the daemon is running, pair each phone once:

```sh
herdr-connect pair
```

The command prints a QR code. In the iOS app, open Settings → Pair new device and scan it. Pairing pins the daemon certificate fingerprint and issues a per-device bearer token. Manage paired devices from the host with:

```sh
herdr-connect devices list
herdr-connect devices revoke <device_id>
```

The LAN transport is HTTPS with a self-signed ECDSA P-256 certificate whose SHA-256 fingerprint is pinned by the phone. All agent endpoints require a paired-device bearer token; `/v1/pair` accepts only a one-time secret. This is the supported LAN-only product model, not a temporary demonstration path. For exact guarantees and limits, see [LAN TLS and pairing](../security/lan-tls-pairing.md).

## Verify the checksum

On Linux:

```sh
sha256sum -c SHA256SUMS --ignore-missing
```

On macOS:

```sh
shasum -a 256 herdr-connect_*.tar.gz
```

Compare the output with the matching entry in `SHA256SUMS`.

## Known limitations

- Binaries are not Apple-notarized or Windows code-signed, so the operating system may show an origin warning.
- Windows service management is not implemented; use the foreground `demo-lan` command on Windows.
- Android APKs are not published yet.
- Message-layer E2EE and official remote relay access are future milestones; the current release is LAN-only.

For source setup and development commands, return to the [project README](https://github.com/Tomyail/herdr-connect#readme).
For CLI help, diagnostics formats, and exit codes, see the [CLI guide](../cli.md).
