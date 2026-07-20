package daemoncli

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/Tomyail/herdr-connect/internal/lanauth"
	"github.com/Tomyail/herdr-connect/internal/store"
)

type deviceEntry struct {
	DeviceID   string  `json:"device_id"`
	Name       string  `json:"name"`
	PairedAt   string  `json:"paired_at"`
	LastSeenAt *string `json:"last_seen_at"`
	Status     string  `json:"status"`
	RevokedAt  *string `json:"revoked_at"`
}

func runDevices(ctx context.Context, database *store.Store, args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintln(stderr, "error: devices requires a subcommand: list or revoke <device_id>\nRun 'herdr-connect help devices' for usage.")
		return 2
	}
	switch args[0] {
	case "list":
		return runDevicesList(ctx, database, stdout, stderr)
	case "revoke":
		return runDevicesRevoke(ctx, database, args[1:], stdout, stderr)
	default:
		fmt.Fprintf(stderr, "error: unknown devices subcommand %q\nRun 'herdr-connect help devices' for usage.\n", args[0])
		return 2
	}
}

func runDevicesList(ctx context.Context, database *store.Store, stdout, stderr io.Writer) int {
	devices, err := database.ListPairedDevices(ctx)
	if err != nil {
		return printError(stderr, err)
	}
	// 空库返回空 JSON 数组（而非 null），便于脚本消费。
	entries := make([]deviceEntry, 0, len(devices))
	for _, device := range devices {
		entry := deviceEntry{
			DeviceID: device.DeviceID,
			Name:     device.Name,
			PairedAt: time.UnixMilli(device.PairedAtMs).UTC().Format(time.RFC3339),
		}
		if device.LastSeenAtMs != nil {
			val := time.UnixMilli(*device.LastSeenAtMs).UTC().Format(time.RFC3339)
			entry.LastSeenAt = &val
		}
		if device.RevokedAtMs != nil {
			entry.Status = "revoked"
			val := time.UnixMilli(*device.RevokedAtMs).UTC().Format(time.RFC3339)
			entry.RevokedAt = &val
		} else {
			entry.Status = "active"
		}
		entries = append(entries, entry)
	}
	return writeJSON(stdout, entries)
}

func runDevicesRevoke(ctx context.Context, database *store.Store, args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintln(stderr, "error: devices revoke requires a <device_id>\nUsage: herdr-connect devices revoke <device_id>")
		return 2
	}
	if len(args) > 1 {
		fmt.Fprintln(stderr, "error: devices revoke accepts exactly one <device_id>\nUsage: herdr-connect devices revoke <device_id>")
		return 2
	}
	deviceID := args[0]

	device, found, err := database.GetPairedDevice(ctx, deviceID)
	if err != nil {
		return printError(stderr, fmt.Errorf("look up device: %w", err))
	}
	if !found {
		fmt.Fprintf(stderr, "error: device %q not found\n", deviceID)
		return 1
	}

	if err := lanauth.RevokeDevice(ctx, database, deviceID); err != nil {
		fmt.Fprintf(stderr, "error: %v\n", err)
		return 1
	}
	fmt.Fprintf(stdout, "Revoked device %q (device_id: %s).\n", device.Name, deviceID)
	return 0
}

func validateDevicesArgs(args []string) string {
	if len(args) == 0 {
		return "devices requires a subcommand: list or revoke <device_id>"
	}
	switch args[0] {
	case "list":
		if len(args) != 1 {
			return "devices list does not accept arguments"
		}
	case "revoke":
		if len(args) != 2 {
			return "devices revoke requires a <device_id>"
		}
	default:
		return fmt.Sprintf("unknown devices subcommand %q", args[0])
	}
	return ""
}
