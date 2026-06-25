"use client";

/**
 * ReaderHighlightsProvider (M11 / REF-030)
 *
 * Eagerly fetches the current user's highlights for an article on reader mount.
 * Exposes CRUD with optimistic updates so marks appear instantly.
 *
 * Two consumers read from this context:
 *  - WordLookup: applies <mark> wrappers to the prose DOM
 *  - ReaderNotesPanel: renders the Notes tab list
 *
 * Orphaned highlights (those that can't be re-anchored in the current DOM) are
 * tracked in `orphanedIds`. The mark renderer calls `markOrphaned(id)` when it
 * can't locate a highlight's text range.
 *
 * Internals are split into focused sub-modules (REF-030):
 *   highlightsReducer  — pure state store (optimistic CRUD actions)
 *   useHighlightsApi   — GET/POST/PATCH/DELETE adapter + offline fallback
 */

import {
  createContext,
  useContext,
  useReducer,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { highlightsReducer } from "@/components/reader/highlightsReducer";
import { useHighlightsApi } from "@/components/reader/useHighlightsApi";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HighlightColor = "yellow" | "green" | "blue" | "pink";

export const HIGHLIGHT_COLORS: HighlightColor[] = [
  "yellow",
  "green",
  "blue",
  "pink",
];

export interface Highlight {
  id: string;
  quote: string;
  startOffset: number;
  endOffset: number;
  prefix: string;
  suffix: string;
  note: string | null;
  color: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateHighlightInput {
  quote: string;
  startOffset: number;
  endOffset: number;
  prefix?: string;
  suffix?: string;
  note?: string;
  color?: HighlightColor;
}

interface HighlightsContextValue {
  highlights: Highlight[];
  loading: boolean;
  orphanedIds: ReadonlySet<string>;
  /** Optimistic create. Resolves when the API call completes. */
  add: (input: CreateHighlightInput) => Promise<Highlight | null>;
  /** Optimistic color update. */
  updateColor: (id: string, color: HighlightColor | null) => Promise<void>;
  /** Optimistic note update. */
  updateNote: (id: string, note: string | null) => Promise<void>;
  /** Optimistic delete. */
  remove: (id: string) => Promise<void>;
  /** Called by the mark renderer when a highlight can't be located. */
  markOrphaned: (id: string) => void;
  /** Aria-live announcement string (changes to trigger screen-reader announcements). */
  liveAnnouncement: string;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const HighlightsContext = createContext<HighlightsContextValue | null>(null);

export function useHighlights(): HighlightsContextValue {
  const ctx = useContext(HighlightsContext);
  if (!ctx) {
    throw new Error("useHighlights must be used within ReaderHighlightsProvider");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface Props {
  articleId: string;
  children: ReactNode;
}

export function ReaderHighlightsProvider({ articleId, children }: Props) {
  const [highlights, dispatch] = useReducer(highlightsReducer, []);
  const [orphanedIds, setOrphanedIds] = useState<Set<string>>(new Set());
  const [liveAnnouncement, setLiveAnnouncement] = useState("");

  const announce = useCallback((msg: string) => {
    setLiveAnnouncement("");
    // Tiny gap so repeated identical messages re-trigger assistive technology.
    setTimeout(() => setLiveAnnouncement(msg), 50);
  }, []);

  const {
    loading,
    add,
    updateColor,
    updateNote,
    remove: apiRemove,
  } = useHighlightsApi({ articleId, highlights, dispatch, announce });

  const markOrphaned = useCallback((id: string) => {
    setOrphanedIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  // Wrap apiRemove to also clear the orphanedIds entry.
  const remove = useCallback(
    async (id: string) => {
      setOrphanedIds((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
      await apiRemove(id);
    },
    [apiRemove],
  );

  return (
    <HighlightsContext.Provider
      value={{
        highlights,
        loading,
        orphanedIds,
        add,
        updateColor,
        updateNote,
        remove,
        markOrphaned,
        liveAnnouncement,
      }}
    >
      {children}
      {/* Aria-live region for screen-reader announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="rw-sr-live"
      >
        {liveAnnouncement}
      </div>
    </HighlightsContext.Provider>
  );
}
