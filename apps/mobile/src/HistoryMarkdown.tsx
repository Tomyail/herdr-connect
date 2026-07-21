import { Fragment, type ReactNode } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";

import { parseHistoryMarkdown, type InlineSpan, type MarkdownLine } from "./history-markdown";

interface HistoryMarkdownStyles {
  base: StyleProp<TextStyle>;
  header: StyleProp<TextStyle>;
  bold: StyleProp<TextStyle>;
  code: StyleProp<TextStyle>;
}

function renderSpan(span: InlineSpan, key: string, styles: HistoryMarkdownStyles): ReactNode {
  switch (span.kind) {
    case "bold":
      return (
        <Text key={key} style={styles.bold}>
          {span.value}
        </Text>
      );
    case "code":
      return (
        <Text key={key} style={styles.code}>
          {span.value}
        </Text>
      );
    case "text":
      return span.value;
  }
}

function renderLine(line: MarkdownLine, key: string, styles: HistoryMarkdownStyles): ReactNode {
  switch (line.kind) {
    case "header":
      return (
        <Text key={key} style={styles.header}>
          {line.text}
        </Text>
      );
    case "code":
      return (
        <Text key={key} style={styles.code}>
          {line.text}
        </Text>
      );
    case "text":
      return (
        <Fragment key={key}>
          {line.spans.map((span, index) => (
            <Fragment key={`${key}-${index}`}>{renderSpan(span, `${key}-${index}`, styles)}</Fragment>
          ))}
        </Fragment>
      );
  }
}

/**
 * Renders agent history text as a single selectable Text tree with a safe
 * inline-markdown subset (bold, inline/fenced code, headers) styled in,
 * everything else left as plain characters. Deliberately renders all lines
 * inside one parent Text (nested Text spans, joined by literal "\n" children)
 * rather than one Text per line, so cross-line selection still works the way
 * the previous plain-text rendering did.
 */
export function HistoryMarkdown({
  text,
  styles,
}: {
  text: string;
  styles: HistoryMarkdownStyles;
}) {
  const lines = parseHistoryMarkdown(text);
  return (
    <Text selectable style={styles.base}>
      {lines.map((line, index) => (
        <Fragment key={index}>
          {index > 0 ? "\n" : null}
          {renderLine(line, `line-${index}`, styles)}
        </Fragment>
      ))}
    </Text>
  );
}
