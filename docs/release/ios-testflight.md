# Install the iOS TestFlight app

[简体中文](../zh-CN/release/ios-testflight.md)

The iOS app is distributed through Apple's TestFlight:

**[Join the Herdr Connect TestFlight beta](https://testflight.apple.com/join/ZkRzJ6rm)**

The public beta has passed Beta App Review and is open to testers. Individual replacement builds may briefly remain unavailable while Apple processes or reviews them.

## Before you install

- Install Apple's TestFlight app on your iPhone.
- Install and start the [v0.1.0-preview.2 daemon](daemon.md) on a computer.
- Put the iPhone and daemon host on the same reachable LAN (physical Wi-Fi or a VPN that makes both devices mutually reachable).
- Ensure VPN and firewall settings do not block local multicast, HTTPS to TCP port `9808`, or the host firewall rule for the daemon.

## Connect on the LAN

1. Open the TestFlight invitation on the iPhone and install Herdr Connect.
2. Start the daemon. On macOS/Linux the usual path is `herdr-connect service install`; on Windows keep `herdr-connect --source herdr demo-lan` running in a foreground terminal.
3. Open Herdr Connect and allow Local Network access when iOS asks.
4. Pair the phone: run `herdr-connect pair` on the daemon host, then in the app open Settings → Pair new device and scan the QR code.
5. Return to the Agents tab. The app discovers `_herdr-connect._tcp`, connects over pinned HTTPS, and uses the paired-device token for Agent API calls.

Pairing pins the daemon certificate fingerprint and exchanges a one-time QR secret for a per-device bearer token. Recent terminal output and text input are reachable only through the authenticated LAN API. Message-layer E2EE is not part of the LAN release; it is reserved for the future relay milestone. See [LAN TLS and pairing](../security/lan-tls-pairing.md) for the exact trust model.

## Troubleshooting

- In iOS Settings, confirm Local Network access is enabled for Herdr Connect.
- Disable VPNs temporarily if they block local multicast, or use a VPN that intentionally places both devices on the same virtual LAN.
- Check that both devices can reach TCP port `9808` on the daemon host.
- Check the router for AP/client isolation or a guest-network boundary.
- Allow the daemon through the host firewall.
- If pairing fails, run `herdr-connect pair` again to generate a fresh one-time QR secret.
- If TestFlight temporarily offers no build, the newest replacement build may still be processing or awaiting review.

Official remote connectivity is not part of the current release. It remains a future relay/E2EE milestone; VPN-based same-network use is an unofficial deployment pattern described in the README.
