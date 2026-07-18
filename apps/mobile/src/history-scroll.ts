export const HISTORY_BOTTOM_THRESHOLD = 80;

export interface HistoryScrollMetrics {
  contentHeight: number;
  offsetY: number;
  viewportHeight: number;
}

export interface HistoryContent {
  text: string;
  truncated: boolean;
}

/** Herdr pane revisions do not reliably change with the returned text. */
export function isSameHistoryContent(
  current: HistoryContent | undefined,
  next: HistoryContent,
): boolean {
  return current !== undefined && current.text === next.text && current.truncated === next.truncated;
}

/** Whether a history viewport is close enough to the bottom to follow new output. */
export function isHistoryNearBottom(
  { contentHeight, offsetY, viewportHeight }: HistoryScrollMetrics,
  threshold = HISTORY_BOTTOM_THRESHOLD,
): boolean {
  return contentHeight - viewportHeight - offsetY <= threshold;
}
