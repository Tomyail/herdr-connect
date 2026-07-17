# Install the iOS TestFlight preview

[简体中文](../zh-CN/release/ios-testflight.md)

The iOS preview is distributed through Apple's TestFlight:

**[Join the Herdr Connect TestFlight beta](https://testflight.apple.com/join/ZkRzJ6rm)**

The public beta has passed Beta App Review and is open to testers. Individual replacement builds may briefly remain unavailable while Apple processes or reviews them.

## Before you install

- Install Apple's TestFlight app on your iPhone.
- Install and start the [v0.1.0-preview.1 daemon](daemon.md) on a computer.
- Put the iPhone and daemon host on the same trusted Wi-Fi network without client isolation.
- Ensure VPN and firewall settings do not block local multicast or TCP port `9808`.

## Connect on the LAN

1. Open the TestFlight invitation on the iPhone and install Herdr Connect.
2. Start the daemon with `herdr-connect --source herdr demo-lan`.
3. Open Herdr Connect and allow Local Network access when iOS asks.
4. Wait for the app to discover `_herdr-connect._tcp` on the same LAN.

The current demo sends recent terminal output and text input over unencrypted local HTTP. It has no pairing, authentication, or end-to-end encryption. Test only on a network and devices you control, do not enter secrets, and stop the daemon when finished.

## Troubleshooting

- In iOS Settings, confirm Local Network access is enabled for Herdr Connect.
- Disable VPNs temporarily and check that both devices use the same Wi-Fi network.
- Check the router for AP/client isolation or a guest-network boundary.
- Allow the daemon through the host firewall and confirm TCP port `9808` is reachable locally.
- If TestFlight temporarily offers no build, the newest replacement build may still be processing or awaiting review.

Remote connectivity is not part of this preview. It remains a later TODO after reliable and safe LAN discovery and connection.
