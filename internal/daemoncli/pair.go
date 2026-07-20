package daemoncli

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"sort"
	"time"

	"github.com/Tomyail/herdr-connect/internal/lanauth"
	"github.com/Tomyail/herdr-connect/internal/store"

	"github.com/mdp/qrterminal/v3"
)

const (
	// pairPort 必须与 demolan.DefaultAddress 的端口一致（mDNS 广播也固定 9808）。
	pairPort = 9808
	// pairPollInterval 默认轮询间隔；pairDeps.pollInterval 可覆盖（测试用）。
	pairPollInterval = time.Second
	// pairTimeoutMargin secret TTL 之外额外宽限的等待时间。
	pairTimeoutMargin = 10 * time.Second
)

// pairingQR 是 pair 命令渲染 QR 时序列化的凭据包：指纹用于 TLS pinning，
// hosts/port 给手机端连接，secret 是一次性配对票据。
type pairingQR struct {
	Version int      `json:"v"`
	FP      string   `json:"fp"`
	Hosts   []string `json:"hosts"`
	Port    int      `json:"port"`
	Secret  string   `json:"secret"`
}

// pairDeps 是 pair 子命令的最小未导出函数依赖注入点。每个字段是一个可替换的
// 协作函数，测试无需触碰真实网络/终端即可驱动 pair 流程；生产路径用默认值。
type pairDeps struct {
	newSecret    func(ctx context.Context, db *store.Store) (plaintext string, expiresAt time.Time, err error)
	pollStatus   func(ctx context.Context, db *store.Store, secretHash []byte) (consumed bool, deviceID string, err error)
	addresses    func() []string
	renderQR     func(payload pairingQR, writer io.Writer)
	now          func() time.Time
	sleep        func(ctx context.Context, d time.Duration) error
	pollInterval time.Duration
}

// newPairDeps 组装生产路径的默认依赖。
func newPairDeps() pairDeps {
	return pairDeps{
		newSecret: lanauth.NewPairingSecret,
		pollStatus: func(ctx context.Context, db *store.Store, secretHash []byte) (bool, string, error) {
			return db.PairingSecretStatus(ctx, secretHash)
		},
		addresses: collectLANHosts,
		renderQR: func(payload pairingQR, writer io.Writer) {
			encoded, err := json.Marshal(payload)
			if err != nil {
				return
			}
			qrterminal.GenerateHalfBlock(string(encoded), qrterminal.M, writer)
			fmt.Fprintln(writer)
		},
		now:          time.Now,
		sleep:        sleepCtx,
		pollInterval: pairPollInterval,
	}
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(d):
		return nil
	}
}

// runPair 实现 `herdr-connect pair`：探活（由 execute 前置完成）→ 取指纹 →
// 发 secret → 渲染终端 QR → 轮询直到 secret 被消费或超时。
// database 由调用方负责生命周期（defer Close）。
func runPair(ctx context.Context, deps pairDeps, database *store.Store, tlsDir string, stdout, stderr io.Writer) int {
	if deps.newSecret == nil {
		deps.newSecret = lanauth.NewPairingSecret
	}
	if deps.pollStatus == nil {
		deps.pollStatus = func(ctx context.Context, db *store.Store, secretHash []byte) (bool, string, error) {
			return db.PairingSecretStatus(ctx, secretHash)
		}
	}
	if deps.addresses == nil {
		deps.addresses = collectLANHosts
	}
	if deps.renderQR == nil {
		deps.renderQR = renderQRDefault
	}
	if deps.now == nil {
		deps.now = time.Now
	}
	if deps.sleep == nil {
		deps.sleep = sleepCtx
	}
	if deps.pollInterval == 0 {
		deps.pollInterval = pairPollInterval
	}

	cert, err := lanauth.LoadOrCreateCertificate(tlsDir)
	if err != nil {
		return printError(stderr, fmt.Errorf("load LAN TLS identity: %w", err))
	}

	secretPlaintext, expiresAt, err := deps.newSecret(ctx, database)
	if err != nil {
		return printError(stderr, fmt.Errorf("issue pairing secret: %w", err))
	}

	deps.renderQR(pairingQR{
		Version: 1,
		FP:      cert.FingerprintBase64(),
		Hosts:   deps.addresses(),
		Port:    pairPort,
		Secret:  secretPlaintext,
	}, stdout)
	fmt.Fprintln(stdout, "Waiting for a device to complete pairing...")

	secretHash := sha256.Sum256([]byte(secretPlaintext))
	deadline := expiresAt.Add(pairTimeoutMargin)
	consumed, device, err := pollPairing(ctx, deps, database, secretHash[:], deadline)
	if err != nil {
		return printError(stderr, err)
	}
	if !consumed {
		fmt.Fprintln(stderr, "error: pairing timed out before any device completed pairing; run 'herdr-connect pair' again")
		return 1
	}
	fmt.Fprintf(stdout, "Paired device %q (device_id: %s) successfully.\n", device.Name, device.DeviceID)
	return 0
}

type pairedDeviceInfo struct {
	DeviceID string
	Name     string
}

func renderQRDefault(payload pairingQR, writer io.Writer) {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return
	}
	qrterminal.GenerateHalfBlock(string(encoded), qrterminal.M, writer)
	fmt.Fprintln(writer)
}

// pollPairing 用注入的 pollStatus/sleep/now 驱动轮询循环；secret 被消费后
// 读取 paired_devices 取设备名与 device_id。
func pollPairing(ctx context.Context, deps pairDeps, database *store.Store, secretHash []byte, deadline time.Time) (bool, pairedDeviceInfo, error) {
	for {
		consumed, deviceID, statusErr := deps.pollStatus(ctx, database, secretHash)
		if statusErr != nil {
			return false, pairedDeviceInfo{}, fmt.Errorf("read pairing status: %w", statusErr)
		}
		if consumed {
			info := pairedDeviceInfo{DeviceID: deviceID}
			if device, found, lookupErr := database.GetPairedDevice(ctx, deviceID); lookupErr != nil {
				return false, pairedDeviceInfo{}, fmt.Errorf("read paired device: %w", lookupErr)
			} else if found {
				info.Name = device.Name
			}
			return true, info, nil
		}
		if deps.now().After(deadline) {
			return false, pairedDeviceInfo{}, nil
		}
		if err := deps.sleep(ctx, deps.pollInterval); err != nil {
			return false, pairedDeviceInfo{}, err
		}
	}
}

// collectLANHosts 枚举本机非回环、非 link-local 的 IPv4/IPv6 地址：IPv4 与 IPv6
// 各自升序排序后再拼接，IPv4 恒定排在 IPv6 前。手机端再按可达性优选。
func collectLANHosts() []string {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	var ipv4, ipv6 []string
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			ipNet, ok := addr.(*net.IPNet)
			if !ok || ipNet.IP.IsLoopback() {
				continue
			}
			ip := ipNet.IP
			if ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
				continue
			}
			if v4 := ip.To4(); v4 != nil {
				ipv4 = appendUnique(ipv4, v4.String())
			} else {
				ipv6 = appendUnique(ipv6, ip.String())
			}
		}
	}
	sort.Strings(ipv4)
	sort.Strings(ipv6)
	hosts := make([]string, 0, len(ipv4)+len(ipv6))
	hosts = append(hosts, ipv4...)
	hosts = append(hosts, ipv6...)
	return hosts
}

func appendUnique(slice []string, value string) []string {
	for _, existing := range slice {
		if existing == value {
			return slice
		}
	}
	return append(slice, value)
}
