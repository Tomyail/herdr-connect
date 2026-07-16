//go:build !darwin

package demolan

import (
	"context"

	"github.com/grandcat/zeroconf"
)

type zeroconfAdvertisement struct {
	server *zeroconf.Server
}

func startAdvertisement(_ context.Context, instance string, port int, text []string) (*zeroconfAdvertisement, error) {
	server, err := zeroconf.Register(instance, ServiceType, "local.", port, text, nil)
	if err != nil {
		return nil, err
	}
	return &zeroconfAdvertisement{server: server}, nil
}

func (a *zeroconfAdvertisement) Shutdown() {
	a.server.Shutdown()
}
