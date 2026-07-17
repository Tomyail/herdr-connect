package main

import (
	"context"
	"strings"
	"testing"
)

func TestSourceFactorySupportsPublicSources(t *testing.T) {
	t.Parallel()

	for _, name := range []string{"herdr", "fake"} {
		name := name
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			source, err := sourceFactory(name)
			if err != nil {
				t.Fatalf("sourceFactory(%q): %v", name, err)
			}
			if source == nil {
				t.Fatalf("sourceFactory(%q) 返回 nil", name)
			}
			if _, err := source.Capabilities(context.Background()); err != nil {
				t.Fatalf("读取 %q capabilities: %v", name, err)
			}
		})
	}
}

func TestSourceFactoryRejectsPrivateAddrSource(t *testing.T) {
	t.Parallel()

	source, err := sourceFactory("addr")
	if source != nil {
		t.Fatal("addr 不应出现在公开版 source factory")
	}
	if err == nil || !strings.Contains(err.Error(), "addr") {
		t.Fatalf("应返回包含 addr 的未知 source 错误，实际为 %v", err)
	}
}
