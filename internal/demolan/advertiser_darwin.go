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

func startAdvertisement(parent context.Context, instance string, port int, text []string) (*processAdvertisement, error) {
	ctx, cancel := context.WithCancel(parent)
	args := []string{"-R", instance, ServiceType, "local.", strconv.Itoa(port)}
	args = append(args, text...)
	command := exec.CommandContext(ctx, "/usr/bin/dns-sd", args...)
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

func (a *processAdvertisement) Shutdown() {
	a.once.Do(a.cancel)
	<-a.done
}
