export const HISTORY_BOTTOM_THRESHOLD = 80;

export interface HistoryScrollMetrics {
  contentHeight: number;
  offsetY: number;
  viewportHeight: number;
}

/** Whether a history viewport is close enough to the bottom to follow new output. */
export function isHistoryNearBottom(
  { contentHeight, offsetY, viewportHeight }: HistoryScrollMetrics,
  threshold = HISTORY_BOTTOM_THRESHOLD,
): boolean {
  return contentHeight - viewportHeight - offsetY <= threshold;
}
