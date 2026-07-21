package herdrsource

import (
	"os"
	"strings"
	"testing"
)

func readTestdata(t *testing.T, name string) string {
	t.Helper()
	data, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatalf("read testdata %s: %v", name, err)
	}
	return string(data)
}

// Real captures via `herdr agent read <id> --source recent-unwrapped`, one
// per coding-agent CLI observed running concurrently on the same machine.
// Each has a completely different footer/border style; the classifier must
// not need agent-specific rules to clean any of them.
func TestStripTUIChromeRealCaptures(t *testing.T) {
	t.Parallel()

	t.Run("claude", func(t *testing.T) {
		t.Parallel()
		out := stripTUIChrome(readTestdata(t, "pane-claude.txt"))
		// Note: a bare "❯" is NOT checked here — Claude Code also prefixes
		// already-printed user input lines with "❯" in the scrollback (real
		// content, not chrome), so a blanket "no ❯ anywhere" assertion would
		// be wrong. Only the live empty prompt line ("❯" alone) is chrome,
		// and that's covered by the adversarial bare-prompt cases below.
		for _, chrome := range []string{"shift+tab to cycle", "210073 tokens", "bypass permissions"} {
			if strings.Contains(out, chrome) {
				t.Errorf("stripped output still contains chrome %q:\n%s", chrome, out)
			}
		}
		if !strings.Contains(out, "Running…") {
			t.Errorf("stripped output dropped real content, got:\n%s", out)
		}
	})

	t.Run("pi", func(t *testing.T) {
		t.Parallel()
		out := stripTUIChrome(readTestdata(t, "pane-pi.txt"))
		want := "" +
			"   grep -RIn \"no pairing\\|no auth\\|无认证\\|无加密\\|Unsafe LAN demo\\|unsafe LAN demo\" README.md docs/ 2>/dev/null | grep -v 'docs/demo/lan-ios-agent-list.md'\n" +
			" ```\n\n" +
			" 结果为空。\n\n" +
			" - 额外 grep 旧 disclaimer 口径，也为空：\n\n" +
			" ```sh\n" +
			"   grep -RIn \"trusted network\\|trusted local\\|stop .*testing\\|stop .*finished\\|测试结束\\|只.*可信\\|仅限.*可信\\|不安全\" README.md docs SECURITY.md 2>/dev/null | grep -v 'docs/demo/lan-ios-agent-list.md'\n" +
			" ```\n\n" +
			" 结果为空。\n\n" +
			" - 对改动的用户文档做了轻量本地相对链接存在性检查（排除 OpenWiki 里原本就相对 repo 根的生成页链接），通过。\n\n" +
			" 当前状态\n\n" +
			" 仅文档改动，未 commit。\n\n" +
			" Model: deepseek-v4-flash"
		if out != want {
			t.Fatalf("stripped output =\n%q\nwant\n%q", out, want)
		}
		// Known accepted residual: pi's stats footer ("↑1.1M ↓49k ...") has no
		// structural signal tying it to the rule lines above it once those are
		// gone, so it is presumed-status-rescued and dropped along with them —
		// but "Model: deepseek-v4-flash" survives since its own upward
		// neighbor is real prose, not chrome. This is intentional, see
		// tui_chrome.go's isPresumedStatusLine doc comment.
		for _, chrome := range []string{"↑1.1M", "thinking off", "always-approve"} {
			if strings.Contains(out, chrome) {
				t.Errorf("stripped output still contains chrome %q:\n%s", chrome, out)
			}
		}
	})

	t.Run("grok", func(t *testing.T) {
		t.Parallel()
		out := stripTUIChrome(readTestdata(t, "pane-grok.txt"))
		want := "  ┃  We set up X and 小红书 growth projects in the vault: archived tmux→Herdr, merged OpenWiki notes into Resources, and drafted plugin research for follow-audit, early replies, and multi-channel publish."
		if out != want {
			t.Fatalf("stripped output =\n%q\nwant\n%q", out, want)
		}
	})
}

func TestStripTUIChromeAdversarial(t *testing.T) {
	t.Parallel()

	realFooter := "  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents                    912380 tokens"
	realRule := strings.Repeat("─", 40)
	chromeBlock := strings.Join([]string{"", realRule, "❯", realRule, realFooter}, "\n")

	cases := []struct {
		name string
		in   string
		want string
	}{
		{
			name: "short markdown divider survives",
			in:   "a\n---\nb",
			want: "a\n---\nb",
		},
		{
			name: "markdown table with no trailing chrome survives verbatim",
			in:   "summary\n\n| feature | status |\n| --- | --- |\n| foo | done |",
			want: "summary\n\n| feature | status |\n| --- | --- |\n| foo | done |",
		},
		{
			name: "markdown table followed by real chrome strips only the chrome",
			in:   "summary\n\n| feature | status |\n| --- | --- |\n| foo | done |" + chromeBlock,
			want: "summary\n\n| feature | status |\n| --- | --- |\n| foo | done |",
		},
		{
			name: "short divider followed by real chrome strips only the chrome",
			in:   "Summary\n---" + chromeBlock,
			want: "Summary\n---",
		},
		{
			name: "lone middot with no keyboard vocab is not a legend line",
			in:   "we covered a lot today · let's begin",
			want: "we covered a lot today · let's begin",
		},
		{
			name: "bare space/tab/enter words without colon are not keyboard vocab",
			in:   "We have plenty of space · let's continue, take your time",
			want: "We have plenty of space · let's continue, take your time",
		},
		{
			name: "trend arrow adversarial case is a known accepted false positive",
			in:   "conversion rate ↑ 12% · nice work",
			want: "",
		},
		{
			name: "ANSI-colored rule and content do not corrupt classification",
			in:   "\x1b[32mreal content\x1b[0m" + chromeBlock,
			want: "real content",
		},
		{
			name: "CRLF input does not leak trailing carriage returns",
			in:   "real content\r\n" + strings.ReplaceAll(chromeBlock, "\n", "\r\n"),
			want: "real content",
		},
		{
			// Rescue only fires for a line directly touching (skipping
			// blanks) an independently chrome-classified line, so each
			// "X" here needs its own adjacent rule to be a rescue
			// candidate; the budget caps how many such candidates can be
			// rescued per document, not how far a single rescue chains.
			name: "rescue budget caps at two independent candidates",
			in:   strings.Join([]string{"anchor", realRule, "X1", realRule, "X2", realRule, "X3"}, "\n"),
			want: strings.Join([]string{"anchor", realRule, "X1"}, "\n"),
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := stripTUIChrome(tc.in); got != tc.want {
				t.Fatalf("stripTUIChrome(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}
