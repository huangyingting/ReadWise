"use client";

/**
 * ReaderHighlightsProvider (M11)
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
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

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
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [orphanedIds, setOrphanedIds] = useState<Set<string>>(new Set());
  const [liveAnnouncement, setLiveAnnouncement] = useState("");

  function announce(msg: string) {
    setLiveAnnouncement("");
    // tiny gap so repeated identical msgs re-trigger AT
    setTimeout(() => setLiveAnnouncement(msg), 50);
  }

  // Initial fetch
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/reader/${articleId}/highlights`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: { highlights: Highlight[] }) => {
        if (!cancelled) {
          setHighlights(data.highlights);
        }
      })
      .catch(() => {
        /* silently degrade — highlights just won't show */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [articleId]);

  const markOrphaned = useCallback((id: string) => {
    setOrphanedIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  // ---- add ----
  const add = useCallback(
    async (input: CreateHighlightInput): Promise<Highlight | null> => {
      // Optimistic placeholder
      const tempId = `optimistic-${Date.now()}`;
      const optimistic: Highlight = {
        id: tempId,
        quote: input.quote,
        startOffset: input.startOffset,
        endOffset: input.endOffset,
        prefix: input.prefix ?? "",
        suffix: input.suffix ?? "",
        note: input.note ?? null,
        color: input.color ?? "yellow",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      setHighlights((prev) =>
        [...prev, optimistic].sort((a, b) => a.startOffset - b.startOffset),
      );

      try {
        const res = await fetch(`/api/reader/${articleId}/highlights`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as { highlight: Highlight };
        const real = data.highlight;
        setHighlights((prev) =>
          prev
            .map((h) => (h.id === tempId ? real : h))
            .sort((a, b) => a.startOffset - b.startOffset),
        );
        announce("Highlight added");
        return real;
      } catch {
        // Revert
        setHighlights((prev) => prev.filter((h) => h.id !== tempId));
        announce("Failed to save highlight");
        return null;
      }
    },
    [articleId],
  );

  // ---- updateColor ----
  const updateColor = useCallback(
    async (id: string, color: HighlightColor | null): Promise<void> => {
      const prev = highlights.find((h) => h.id === id);
      if (!prev) return;
      setHighlights((hs) =>
        hs.map((h) => (h.id === id ? { ...h, color } : h)),
      );
      try {
        const res = await fetch(`/api/highlights/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ color }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { highlight: Highlight };
        setHighlights((hs) =>
          hs.map((h) => (h.id === id ? data.highlight : h)),
        );
      } catch {
        // Revert
        setHighlights((hs) => hs.map((h) => (h.id === id ? prev : h)));
      }
    },
    [highlights],
  );

  // ---- updateNote ----
  const updateNote = useCallback(
    async (id: string, note: string | null): Promise<void> => {
      const prev = highlights.find((h) => h.id === id);
      if (!prev) return;
      setHighlights((hs) =>
        hs.map((h) => (h.id === id ? { ...h, note } : h)),
      );
      try {
        const res = await fetch(`/api/highlights/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { highlight: Highlight };
        setHighlights((hs) =>
          hs.map((h) => (h.id === id ? data.highlight : h)),
        );
        announce("Note saved");
      } catch {
        setHighlights((hs) => hs.map((h) => (h.id === id ? prev : h)));
        announce("Failed to save note");
      }
    },
    [highlights],
  );

  // ---- remove ----
  const remove = useCallback(
    async (id: string): Promise<void> => {
      const prev = highlights.find((h) => h.id === id);
      if (!prev) return;
      setHighlights((hs) => hs.filter((h) => h.id !== id));
      setOrphanedIds((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
      try {
        const res = await fetch(`/api/highlights/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        announce("Highlight deleted");
      } catch {
        // Revert
        setHighlights((hs) =>
          [...hs, prev].sort((a, b) => a.startOffset - b.startOffset),
        );
        announce("Failed to delete highlight");
      }
    },
    [highlights],
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
