//go:build darwin

package demolan

import (
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"sync"
)

type processAdvertisement struct {
	cancel context.CancelFunc
	done   chan struct{}
	once   sync.Once
}

const dnsSDBinary = "/usr/bin/dns-sd"

func startAdvertisement(parent context.Context, instance string, port int, text []string) (*processAdvertisement, error) {
	killStaleAdvertisements()

	ctx, cancel := context.WithCancel(parent)
	args := []string{"-R", instance, ServiceType, "local.", strconv.Itoa(port)}
	args = append(args, text...)
	command := exec.CommandContext(ctx, dnsSDBinary, args...)
	if err := command.Start(); err != nil {
		cancel()
		return nil, fmt.Errorf("启动 macOS Bonjour 注册: %w", err)
	}
	result := &processAdvertisement{cancel: cancel, done: make(chan struct{})}
	go func() {
		_ = command.Wait()
		close(result.done)
	}()
	return result, nil
}

// killStaleAdvertisements 清理上一次异常退出（kill -9、崩溃、终端被强杀）遗留
// 的 dns-sd -R 子进程。context 取消只在本进程正常走到 Shutdown 时才能杀掉
// 子进程；非正常退出时子进程会被系统 reparent 到 launchd 下，永远挂着，继续
// 用旧证书指纹广播同一个 _herdr-connect._tcp 服务，和当前实例产生冲突/过期
// 的 mDNS 记录，可能是配对后连接不稳定的一个来源。
//
// 这里能安全地把所有匹配到的进程都杀掉：调用方在拿到 TLS 监听端口之后才会
// 走到这一步，意味着当前机器上不可能还有另一个真正持有该端口的 demo-lan 实
// 例在跑（否则会在 tls.Listen 那一步就已经因为 EADDRINUSE 失败），所以匹配
// 到的必然是孤儿进程。
func killStaleAdvertisements() {
	_ = exec.Command("/usr/bin/pkill", "-f", dnsSDBinary+" -R.*"+ServiceType).Run()
}

func (a *processAdvertisement) Shutdown() {
	a.once.Do(a.cancel)
	<-a.done
}
