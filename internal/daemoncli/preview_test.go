package daemoncli

import (
	"bytes"
	"errors"
	"fmt"
	"strings"
	"syscall"
	"testing"
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
