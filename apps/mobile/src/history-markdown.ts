export type InlineSpan =
  | { kind: "text"; value: string }
  | { kind: "bold"; value: string }
  | { kind: "code"; value: string };

export type MarkdownLine =
  | { kind: "header"; text: string }
  | { kind: "code"; text: string }
  | { kind: "text"; spans: InlineSpan[] };

const HEADER_RE = /^(#{1,6})\s+(.+)$/;
const FENCE_RE = /^```(\S*)/;
const INLINE_RE = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;

function parseInline(line: string): InlineSpan[] {
  if (line === "") return [{ kind: "text", value: "" }];
  return line
    .split(INLINE_RE)
    .filter((part) => part.length > 0)
    .map((part): InlineSpan => {
      if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
        return { kind: "bold", value: part.slice(2, -2) };
      }
      if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
        return { kind: "code", value: part.slice(1, -1) };
      }
      return { kind: "text", value: part };
    });
}

/**
 * Parses agent history text into renderable lines, preserving the original
 * line-by-line structure rather than doing CommonMark-style paragraph reflow.
 * This text is a terminal capture, not authored markdown — tool-call output
 * relies on its literal line breaks (e.g. "⎿ line one\n   line two"), which
 * reflow would mangle. Only a safe inline subset is recognized: **bold**,
 * `inline code`, fenced code blocks, and "#" headers.
 */
export function parseHistoryMarkdown(text: string): MarkdownLine[] {
  const result: MarkdownLine[] = [];
  let inCode = false;
  for (const line of text.split("\n")) {
    const fence = FENCE_RE.exec(line.trim());
    if (fence) {
      // A `recent-unwrapped` capture is a tail window: it may start already
      // inside a code block whose opening fence scrolled off-screen, which
      // desyncs a naive open/close toggle for every fence after it. A fence
      // with a language tag (like "```sh") is always an opening fence by
      // convention — bare closing fences never carry one — so it force-opens
      // rather than blindly toggling, keeping one bad guess from cascading
      // into misclassifying the rest of the capture.
      inCode = fence[1] !== "" ? true : !inCode;
      continue;
    }
    if (inCode) {
      result.push({ kind: "code", text: line });
      continue;
    }
    const header = HEADER_RE.exec(line);
    if (header) {
      result.push({ kind: "header", text: header[2] ?? "" });
      continue;
    }
    result.push({ kind: "text", spans: parseInline(line) });
  }
  return result;
}
