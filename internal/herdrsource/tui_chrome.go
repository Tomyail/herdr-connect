package herdrsource

import (
	"regexp"
	"strings"
	"unicode"
)

const (
	// minAsciiFrameLineLength is the minimum trimmed length for an ASCII-only
	// rule line (e.g. "----") to count as a frame/border line. Genuine Unicode
	// box-drawing/block glyphs need no such floor; this floor exists only to
	// keep a short markdown divider like "---" from being misclassified.
	minAsciiFrameLineLength = 12
	// frameGlyphRatioThreshold is the minimum fraction of non-space runes in a
	// trimmed line that must be frame/rule glyphs for the line to count as a
	// border, e.g. Claude's plain "───" rule or grok's "╭──╮" box corners.
	frameGlyphRatioThreshold = 0.7
	// maxPresumedStatusRescues bounds how many otherwise-unclassifiable lines
	// a single ReadAgentHistory capture may have "rescued" as chrome via
	// isPresumedStatusLine, so a long run of ordinary short lines can never
	// cascade into eating real content.
	maxPresumedStatusRescues = 2
	// presumedStatusMaxRunes caps how long a line may be to qualify for the
	// isPresumedStatusLine rescue — real prose runs longer than a status line.
	presumedStatusMaxRunes = 200
)

var (
	ansiEscapeRe = regexp.MustCompile(`\x1b\[[0-9;?]*[a-zA-Z]`)
	// legendSeparatorRe matches menu/legend separators terminal UIs use for
	// keyboard-hint rows. Deliberately excludes the ASCII pipe "|" (too common
	// in markdown tables) in favor of the Unicode box-drawing vertical bar.
	legendSeparatorRe = regexp.MustCompile(`[·•│]`)
	// legendVocabRe matches keyboard/mode vocabulary shared across terminal
	// UIs generally (not any one agent vendor's specific phrasing). Bare
	// "tab"/"enter"/"space" only count when followed by ":" (as in
	// "Space:prompt") to avoid matching ordinary prose that happens to
	// contain those words.
	legendVocabRe  = regexp.MustCompile(`(?i)ctrl\+|shift\+|esc\b|shortcuts|[←→↑↓]|\b(tab|enter|space)\s*:`)
	barePromptLine = regexp.MustCompile(`^[❯>›]$`)
)

// stripTUIChrome removes fixed TUI chrome (input-box borders, mode/keyboard
// hint footers, empty prompt lines) from a raw terminal pane capture.
// `agent read --source recent-unwrapped` returns the visible screen verbatim,
// and every coding-agent CLI pins its own input box and status bar to the
// bottom of the screen — so chrome only ever appears as a contiguous block at
// the tail of the capture, never interspersed with real conversation content.
// This walks backward from the end and peels off lines that look like chrome
// by structure (box-drawing character ratio, keyboard-hint vocabulary, bare
// prompt markers) rather than matching any specific agent's wording, so it
// does not need a new rule for every agent CLI.
func stripTUIChrome(text string) string {
	normalized := strings.ReplaceAll(stripANSI(text), "\r\n", "\n")
	lines := strings.Split(normalized, "\n")
	end := len(lines)
	rescuesLeft := maxPresumedStatusRescues
	for end > 0 {
		idx := end - 1
		if isChromeLine(lines[idx]) {
			end = idx
			continue
		}
		if rescuesLeft > 0 && isPresumedStatusLine(lines, idx) {
			rescuesLeft--
			end = idx
			continue
		}
		break
	}
	return collapseBlankLines(lines[:end])
}

func stripANSI(text string) string {
	return ansiEscapeRe.ReplaceAllString(text, "")
}

func isChromeLine(line string) bool {
	return isBlankLine(line) ||
		isFrameLine(line) ||
		isBoundedByFrameGlyphs(line) ||
		isBarePromptLine(line) ||
		isLegendLine(line)
}

func isBlankLine(line string) bool {
	return strings.TrimSpace(line) == ""
}

// isFrameLine reports whether line, once trimmed, is dominated by box-drawing
// or block-element glyphs (or an ASCII rule fallback), e.g. a plain "───"
// separator or a "╭────╮" box corner with an embedded label.
func isFrameLine(line string) bool {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return false
	}
	runes := []rune(trimmed)
	frameCount := 0
	nonSpaceCount := 0
	hasUnicodeFrame := false
	for _, r := range runes {
		if unicode.IsSpace(r) {
			continue
		}
		nonSpaceCount++
		if isUnicodeFrameGlyph(r) {
			frameCount++
			hasUnicodeFrame = true
		} else if isAsciiFrameGlyph(r) {
			frameCount++
		}
	}
	if nonSpaceCount == 0 {
		return false
	}
	if float64(frameCount)/float64(nonSpaceCount) < frameGlyphRatioThreshold {
		return false
	}
	if hasUnicodeFrame {
		return true
	}
	return len(runes) >= minAsciiFrameLineLength
}

// isBoundedByFrameGlyphs reports whether the first and last trimmed runes are
// both Unicode frame glyphs, catching a box body row like "│ ❯ … │" whose
// interior text/padding keeps it well under the isFrameLine ratio threshold.
// Deliberately Unicode-only (never ASCII "|") so a markdown table row like
// "| a | b |" is never misclassified.
func isBoundedByFrameGlyphs(line string) bool {
	runes := []rune(strings.TrimSpace(line))
	if len(runes) < 2 {
		return false
	}
	return isUnicodeFrameGlyph(runes[0]) && isUnicodeFrameGlyph(runes[len(runes)-1])
}

func isBarePromptLine(line string) bool {
	return barePromptLine.MatchString(strings.TrimSpace(line))
}

// isLegendLine reports whether line looks like a keyboard-hint/mode legend
// row (e.g. "Space:prompt │ Enter:open │ Ctrl+.:shortcuts" or "auto mode on
// (shift+tab to cycle) · ← for agents"): it must contain both a terminal-chrome
// separator glyph and generic keyboard vocabulary, so it doesn't fire on
// ordinary prose that happens to contain a single middot or the word "tab".
func isLegendLine(line string) bool {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" || nonSpaceRuneCount(trimmed) > presumedStatusMaxRunes {
		return false
	}
	return legendSeparatorRe.MatchString(trimmed) && legendVocabRe.MatchString(trimmed)
}

// nonSpaceRuneCount counts non-whitespace runes, ignoring interior padding.
// Terminal footers are routinely right-padded with dozens of spaces to a
// fixed column width (to right-align a trailing note); measuring raw length
// would mistake that padding for a long paragraph, when the actual content is
// short. This is what makes the presumedStatusMaxRunes/legend-length checks
// meaningful signals rather than an accident of column width.
func nonSpaceRuneCount(s string) int {
	count := 0
	for _, r := range s {
		if !unicode.IsSpace(r) {
			count++
		}
	}
	return count
}

func isUnicodeFrameGlyph(r rune) bool {
	return (r >= 0x2500 && r <= 0x257F) || (r >= 0x2580 && r <= 0x259F)
}

func isAsciiFrameGlyph(r rune) bool {
	switch r {
	case '-', '_', '=', '~':
		return true
	}
	return false
}

// isPresumedStatusLine reports whether the line at idx, despite matching no
// direct chrome classifier itself, sits immediately below a line that does
// (skipping blank lines) — e.g. a bare cwd line directly under an input-box
// rule. Bounded by the caller's rescue budget so this can never cascade
// through a whole paragraph.
func isPresumedStatusLine(lines []string, idx int) bool {
	if idx < 0 || idx >= len(lines) {
		return false
	}
	if nonSpaceRuneCount(strings.TrimSpace(lines[idx])) > presumedStatusMaxRunes {
		return false
	}
	for i := idx - 1; i >= 0; i-- {
		if isBlankLine(lines[i]) {
			continue
		}
		return isChromeLine(lines[i])
	}
	return false
}

// collapseBlankLines drops leading/trailing blank lines and squashes runs of
// consecutive blank lines (left behind once chrome lines are removed) to one.
func collapseBlankLines(lines []string) string {
	result := make([]string, 0, len(lines))
	previousBlank := false
	for _, line := range lines {
		blank := strings.TrimSpace(line) == ""
		if blank && previousBlank {
			continue
		}
		result = append(result, line)
		previousBlank = blank
	}
	start := 0
	for start < len(result) && strings.TrimSpace(result[start]) == "" {
		start++
	}
	end := len(result)
	for end > start && strings.TrimSpace(result[end-1]) == "" {
		end--
	}
	return strings.Join(result[start:end], "\n")
}
