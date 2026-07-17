# Install the daemon preview

[简体中文](https://github.com/Tomyail/herdr-connect/blob/main/docs/zh-CN/release/daemon.md)

Herdr Connect provides precompiled daemon archives for macOS, Linux, and Windows. The current public build is [v0.1.0-preview.1](https://github.com/Tomyail/herdr-connect/releases/tag/v0.1.0-preview.1). It is an early preview for trusted local networks, not a production remote-access service.

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

Extract the archive. On macOS or Linux, make the binary executable if necessary and inspect its capabilities:

```sh
chmod +x herdr-connect
./herdr-connect --source fake capabilities
```

Confirm that the separately installed `herdr` CLI is available, then start the LAN demo:

```sh
herdr agent list
./herdr-connect --source herdr diagnostics
./herdr-connect --source herdr demo-lan
```

On Windows, run `herdr-connect.exe` from PowerShell or Command Prompt. The daemon listens on TCP port `9808` and advertises `_herdr-connect._tcp`. Keep it in the foreground and press `Ctrl+C` when finished.

The current demo has no pairing, authentication, or encryption. Use it only on a trusted network, never enter secrets, and stop it after testing. The iPhone and daemon host must be on the same LAN; remote connectivity is a later TODO.

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
- Android APKs are not published with this preview.
- Pairing, device authentication, end-to-end encryption, and remote access are not implemented.

For source setup and development commands, return to the [project README](https://github.com/Tomyail/herdr-connect#readme).
