package daemoncli

import (
	"bytes"
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"syscall"
	"testing"

	"github.com/Tomyail/herdr-connect/internal/lanauth"
)

func TestClassifyPreviewDistinguishesAvailableRunningAndOccupied(t *testing.T) {
	tests := []struct {
		name            string
		endpointRunning bool
		bindErr         error
		want            PreviewStatus
	}{
		{name: "available", want: PreviewAvailable},
		{name: "running", endpointRunning: true, bindErr: errors.New("also occupied"), want: PreviewRunning},
		{name: "occupied", bindErr: errors.New("address in use"), want: PreviewOccupied},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := classifyPreview(test.endpointRunning, test.bindErr); got != test.want {
				t.Fatalf("status = %q, want %q", got, test.want)
			}
		})
	}
}

func TestDemoLANAddressInUseErrorIsActionable(t *testing.T) {
	var stderr bytes.Buffer
	code := printDemoLANError(&stderr, fmt.Errorf("listen failed: %w", syscall.EADDRINUSE))
	if code != 1 || !strings.Contains(stderr.String(), "TCP port 9808 is already in use") || !strings.Contains(stderr.String(), "herdr-connect doctor") {
		t.Fatalf("exit=%d stderr=%q", code, stderr.String())
	}
}

func TestCheckPreviewPinsTheLocalCertificate(t *testing.T) {
	localDir := t.TempDir()
	localCert, err := lanauth.LoadOrCreateCertificate(localDir)
	if err != nil {
		t.Fatalf("create local certificate: %v", err)
	}
	otherCert, err := lanauth.LoadOrCreateCertificate(t.TempDir())
	if err != nil {
		t.Fatalf("create other certificate: %v", err)
	}

	startServer := func(cert tls.Certificate) *httptest.Server {
		server := httptest.NewUnstartedServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
			response.Header().Set("X-Herdr-Connect-Demo-Version", "0")
			response.WriteHeader(http.StatusUnauthorized)
		}))
		server.TLS = &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12}
		server.StartTLS()
		return server
	}

	matching := startServer(localCert.TLS)
	if got := checkPreviewAt(context.Background(), matching.Listener.Addr().String(), []string{matching.URL}, filepath.Join(localDir, lanauth.CertFileName)); got != PreviewRunning {
		matching.Close()
		t.Fatalf("matching certificate status = %q, want %q", got, PreviewRunning)
	}
	matching.Close()

	mismatched := startServer(otherCert.TLS)
	t.Cleanup(mismatched.Close)
	if got := checkPreviewAt(context.Background(), mismatched.Listener.Addr().String(), []string{mismatched.URL}, filepath.Join(localDir, lanauth.CertFileName)); got != PreviewOccupied {
		t.Fatalf("mismatched certificate status = %q, want %q", got, PreviewOccupied)
	}
}

func TestCheckPreviewFallsBackToVersionMarkerBeforeCertificateExists(t *testing.T) {
	serverCert, err := lanauth.LoadOrCreateCertificate(t.TempDir())
	if err != nil {
		t.Fatalf("create server certificate: %v", err)
	}
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("X-Herdr-Connect-Demo-Version", "0")
		response.WriteHeader(http.StatusUnauthorized)
	}))
	server.TLS = &tls.Config{Certificates: []tls.Certificate{serverCert.TLS}, MinVersion: tls.VersionTLS12}
	server.StartTLS()
	t.Cleanup(server.Close)

	missingCertPath := filepath.Join(t.TempDir(), lanauth.CertFileName)
	if got := checkPreviewAt(context.Background(), server.Listener.Addr().String(), []string{server.URL}, missingCertPath); got != PreviewRunning {
		t.Fatalf("missing local certificate status = %q, want %q", got, PreviewRunning)
	}
}
