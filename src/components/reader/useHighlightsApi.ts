"use client";

/**
 * useHighlightsApi — reader highlights API adapter (REF-030).
 *
 * Extracted from ReaderHighlightsProvider.  Handles:
 *  - Initial GET /api/reader/[id]/highlights fetch
 *  - Optimistic CRUD with immediate dispatch + API confirmation
 *  - Offline fallback via submitMutation (RW-042/RW-043)
 *  - Aria-live announcements via the caller-supplied `announce` callback
 *
 * Works with a React dispatch derived from
 * `useReducer(highlightsReducer, [])`.
 */

import { useCallback, useEffect, useState } from "react";
import { submitMutation } from "@/lib/offline/sync-runtime";
import type {
  Highlight,
  CreateHighlightInput,
  HighlightColor,
} from "@/components/ReaderHighlightsProvider";
import type { HighlightAction } from "@/components/reader/highlightsReducer";

/** True for a not-yet-persisted (optimistic) highlight id. */
function isOptimisticId(id: string): boolean {
  return id.startsWith("optimistic-");
}

export interface UseHighlightsApiOptions {
  articleId: string;
  /** Current highlights — needed for existence checks and conflict detection. */
  highlights: Highlight[];
  dispatch: React.Dispatch<HighlightAction>;
  /** Stable announce callback from the provider. */
  announce: (msg: string) => void;
}

export interface HighlightsApi {
  loading: boolean;
  add: (input: CreateHighlightInput) => Promise<Highlight | null>;
  updateColor: (id: string, color: HighlightColor | null) => Promise<void>;
  updateNote: (id: string, note: string | null) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export function useHighlightsApi({
  articleId,
  highlights,
  dispatch,
  announce,
}: UseHighlightsApiOptions): HighlightsApi {
  const [loading, setLoading] = useState(true);

  // Initial fetch
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/reader/${articleId}/highlights`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: { highlights: Highlight[] }) => {
        if (!cancelled) {
          dispatch({ type: "SET", highlights: data.highlights });
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
  }, [articleId, dispatch]);

  // ---- add ----
  const add = useCallback(
    async (input: CreateHighlightInput): Promise<Highlight | null> => {
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
      dispatch({ type: "ADD_OPTIMISTIC", optimistic });
      try {
        const res = await fetch(`/api/reader/${articleId}/highlights`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!res.ok) {
          dispatch({ type: "REVERT_OPTIMISTIC", tempId });
          announce("Failed to save highlight");
          return null;
        }
        const data = (await res.json()) as { highlight: Highlight };
        dispatch({ type: "REPLACE_OPTIMISTIC", tempId, real: data.highlight });
        announce("Highlight added");
        return data.highlight;
      } catch {
        // Network/offline — queue the create (idempotent server-side upsert by
        // anchor offsets) and KEEP the optimistic mark (RW-042).
        void submitMutation({
          type: "highlight.create",
          endpoint: `/api/reader/${articleId}/highlights`,
          method: "POST",
          body: input,
        });
        announce("Highlight saved offline");
        return optimistic;
      }
    },
    [articleId, dispatch, announce],
  );

  // ---- updateColor ----
  const updateColor = useCallback(
    async (id: string, color: HighlightColor | null): Promise<void> => {
      if (!highlights.find((h) => h.id === id)) return;
      dispatch({ type: "UPDATE", id, patch: { color } });
      // An unsaved (optimistic) highlight has no server id yet — its queued
      // create already carries the colour.
      if (isOptimisticId(id)) return;
      try {
        const res = await fetch(`/api/highlights/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ color }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { highlight: Highlight };
        dispatch({ type: "UPDATE", id, patch: data.highlight });
      } catch {
        // Offline — queue and keep the optimistic colour (RW-042).
        void submitMutation({
          type: "highlight.color",
          endpoint: `/api/highlights/${id}`,
          method: "PATCH",
          body: { color },
          dedupeKey: `hl-color:${id}`,
        });
      }
    },
    [highlights, dispatch],
  );

  // ---- updateNote ----
  const updateNote = useCallback(
    async (id: string, note: string | null): Promise<void> => {
      const prev = highlights.find((h) => h.id === id);
      if (!prev) return;
      dispatch({ type: "UPDATE", id, patch: { note } });
      if (isOptimisticId(id)) return;
      // RW-043 — send the updatedAt we based this edit on so the server can
      // detect a concurrent change and MERGE (never silently drop note text).
      const body = { note, baseUpdatedAt: prev.updatedAt };
      try {
        const res = await fetch(`/api/highlights/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          highlight: Highlight;
          conflict?: boolean;
        };
        dispatch({ type: "UPDATE", id, patch: data.highlight });
        announce(
          data.conflict
            ? "Note merged — your text and another device's edit were both kept"
            : "Note saved",
        );
      } catch {
        // Offline — queue and keep the optimistic note (RW-042/RW-043).
        void submitMutation({
          type: "highlight.note",
          endpoint: `/api/highlights/${id}`,
          method: "PATCH",
          body,
          dedupeKey: `hl-note:${id}`,
        });
        announce("Note saved offline");
      }
    },
    [highlights, dispatch, announce],
  );

  // ---- remove ----
  const remove = useCallback(
    async (id: string): Promise<void> => {
      if (!highlights.find((h) => h.id === id)) return;
      dispatch({ type: "REMOVE", id });
      // An optimistic highlight only ever existed locally.
      if (isOptimisticId(id)) {
        announce("Highlight deleted");
        return;
      }
      try {
        const res = await fetch(`/api/highlights/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        announce("Highlight deleted");
      } catch {
        // Offline — queue the delete (idempotent) and keep it removed locally.
        void submitMutation({
          type: "highlight.delete",
          endpoint: `/api/highlights/${id}`,
          method: "DELETE",
          dedupeKey: `hl-delete:${id}`,
        });
        announce("Highlight deleted offline");
      }
    },
    [highlights, dispatch, announce],
  );

  return { loading, add, updateColor, updateNote, remove };
}
