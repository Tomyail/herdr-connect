/**
 * Unseen-completion badges, unread-message style.
 *
 * DoneSoundProvider marks agents here when it detects a completion (whether or
 * not the chime is enabled — the visual marker works with sound off). The
 * Agents list shows a badge for marked agents; the mark clears when the owner
 * opens that agent or when the agent starts working again.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface RecentCompletionsValue {
  /** source_ids with a completion the owner has not looked at yet. */
  completedIds: ReadonlySet<string>;
  /** Mark agents as newly completed. */
  markCompleted: (ids: readonly string[]) => void;
  /** Clear marks (agent opened, or active again). */
  clearCompleted: (ids: readonly string[]) => void;
}

const RecentCompletionsContext = createContext<RecentCompletionsValue | undefined>(undefined);

export function RecentCompletionsProvider({ children }: { children: ReactNode }) {
  const [completedIds, setCompletedIds] = useState<ReadonlySet<string>>(() => new Set());

  const markCompleted = useCallback((ids: readonly string[]) => {
    if (ids.length === 0) return;
    setCompletedIds((prev) => {
      if (ids.every((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  const clearCompleted = useCallback((ids: readonly string[]) => {
    if (ids.length === 0) return;
    setCompletedIds((prev) => {
      if (!ids.some((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  const value = useMemo<RecentCompletionsValue>(
    () => ({ completedIds, markCompleted, clearCompleted }),
    [completedIds, markCompleted, clearCompleted],
  );

  return <RecentCompletionsContext.Provider value={value}>{children}</RecentCompletionsContext.Provider>;
}

export function useRecentCompletions(): RecentCompletionsValue {
  const value = useContext(RecentCompletionsContext);
  if (!value) throw new Error("useRecentCompletions must be used within a RecentCompletionsProvider");
  return value;
}
