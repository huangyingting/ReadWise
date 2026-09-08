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

import { useCallback, useEffect, useRef, useState } from "react";
import {
  captureOfflineMutationGeneration,
  isOfflineMutationGenerationCurrent,
  newClientMutationId,
  queueMutation,
  submitMutation,
  type OfflineMutationGeneration,
  type SubmitResult,
} from "@/lib/offline/sync-runtime";
import { OFFLINE_ACTOR_HEADER } from "@/lib/offline-sync";
import type {
  Highlight,
  CreateHighlightInput,
  HighlightColor,
  RemoveHighlightOptions,
} from "@/components/ReaderHighlightsProvider";
import type { HighlightAction } from "@/components/reader/highlightsReducer";

/** True for a not-yet-persisted (optimistic) highlight id. */
function isOptimisticId(id: string): boolean {
  return id.startsWith("optimistic-");
}

function readerHighlightsEndpoint(articleId: string): string {
  return `/api/reader/${articleId}/highlights`;
}

function highlightEndpoint(id: string): string {
  return `/api/highlights/${id}`;
}

function findHighlight(highlights: Highlight[], id: string): Highlight | undefined {
  return highlights.find((highlight) => highlight.id === id);
}

function createOptimisticHighlight(
  input: CreateHighlightInput,
  tempId: string,
): Highlight {
  return {
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
}

type PendingCreate = {
  clientMutationId: string;
  input: CreateHighlightInput;
  generation: OfflineMutationGeneration;
};

type PendingDelete = {
  clientMutationId: string;
  completion: Promise<SubmitResult>;
};

function pendingAnchor(input: CreateHighlightInput) {
  return {
    startOffset: input.startOffset,
    endOffset: input.endOffset,
  };
}

function pendingAnchorKey(
  articleId: string,
  input: Pick<CreateHighlightInput, "startOffset" | "endOffset">,
): string {
  return `${articleId}:${input.startOffset}:${input.endOffset}`;
}

function pendingAnchorDeleteEndpoint(
  articleId: string,
  input: CreateHighlightInput,
): string {
  const query = new URLSearchParams({
    startOffset: String(input.startOffset),
    endOffset: String(input.endOffset),
  });
  return `${readerHighlightsEndpoint(articleId)}?${query}`;
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
  updateNote: (id: string, note: string | null) => Promise<boolean>;
  remove: (id: string, options?: RemoveHighlightOptions) => Promise<void>;
}

export function useHighlightsApi({
  articleId,
  highlights,
  dispatch,
  announce,
}: UseHighlightsApiOptions): HighlightsApi {
  const [loading, setLoading] = useState(true);
  const pendingCreates = useRef(
    new Map<string, PendingCreate>(),
  );
  const pendingDeletes = useRef(
    new Map<string, PendingDelete>(),
  );

  // Initial fetch
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    fetch(readerHighlightsEndpoint(articleId), { signal: controller.signal })
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
      const generation = captureOfflineMutationGeneration();
      const clientMutationId = newClientMutationId();
      const tempId = `optimistic-${clientMutationId}`;
      const optimistic = createOptimisticHighlight(input, tempId);
      dispatch({ type: "ADD_OPTIMISTIC", optimistic });
      const queueCreate = async (
        dependsOnClientMutationId?: string,
      ): Promise<Highlight | null> => {
        const result = await queueMutation({
          type: "highlight.create",
          endpoint: readerHighlightsEndpoint(articleId),
          method: "POST",
          body: input,
          clientMutationId,
          dependsOnClientMutationId,
          generation,
        });
        if (!result.queued) {
          dispatch({ type: "REVERT_OPTIMISTIC", tempId });
          announce("Failed to save highlight offline");
          return null;
        }
        pendingCreates.current.set(tempId, {
          clientMutationId,
          input,
          generation,
        });
        announce("Highlight saved offline");
        return optimistic;
      };

      const anchorKey = pendingAnchorKey(articleId, input);
      const pendingDelete = pendingDeletes.current.get(anchorKey);
      if (pendingDelete) {
        const deleteResult = await pendingDelete.completion;
        if (deleteResult.queued) {
          return queueCreate(pendingDelete.clientMutationId);
        }
        if (pendingDeletes.current.get(anchorKey) === pendingDelete) {
          pendingDeletes.current.delete(anchorKey);
        }
      }

      const actorId = generation.actorId;
      if (!actorId || !isOfflineMutationGenerationCurrent(generation)) {
        dispatch({ type: "REVERT_OPTIMISTIC", tempId });
        announce("Failed to save highlight");
        return null;
      }
      try {
        const res = await fetch(readerHighlightsEndpoint(articleId), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [OFFLINE_ACTOR_HEADER]: actorId,
          },
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
        return queueCreate();
      }
    },
    [articleId, dispatch, announce],
  );

  // ---- updateColor ----
  const updateColor = useCallback(
    async (id: string, color: HighlightColor | null): Promise<void> => {
      const prev = findHighlight(highlights, id);
      if (!prev) return;
      dispatch({ type: "UPDATE", id, patch: { color } });
      if (isOptimisticId(id)) {
        const pending = pendingCreates.current.get(id);
        if (!pending) {
          dispatch({ type: "UPDATE", id, patch: { color: prev.color } });
          announce("Failed to save highlight color offline");
          return;
        }
        const result = await queueMutation({
          type: "highlight.color",
          endpoint: readerHighlightsEndpoint(articleId),
          method: "PATCH",
          body: { ...pendingAnchor(pending.input), color },
          dedupeKey: `hl-color:${pending.clientMutationId}`,
          dependsOnClientMutationId: pending.clientMutationId,
          generation: pending.generation,
        });
        if (result.queued) return;
        dispatch({ type: "UPDATE", id, patch: { color: prev.color } });
        announce("Failed to save highlight color offline");
        return;
      }
      const generation = captureOfflineMutationGeneration();
      if (
        !generation.actorId ||
        !isOfflineMutationGenerationCurrent(generation)
      ) {
        dispatch({ type: "UPDATE", id, patch: { color: prev.color } });
        announce("Failed to save highlight color");
        return;
      }
      try {
        const res = await fetch(highlightEndpoint(id), {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            [OFFLINE_ACTOR_HEADER]: generation.actorId,
          },
          body: JSON.stringify({ color }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { highlight: Highlight };
        dispatch({ type: "UPDATE", id, patch: data.highlight });
      } catch {
        // Offline — queue and keep the optimistic colour (RW-042).
        const result = await submitMutation({
          type: "highlight.color",
          endpoint: highlightEndpoint(id),
          method: "PATCH",
          body: { color },
          dedupeKey: `hl-color:${id}`,
          generation,
        });
        if (!result.queued) {
          dispatch({ type: "UPDATE", id, patch: { color: prev.color } });
          announce("Failed to save highlight color offline");
        }
      }
    },
    [articleId, highlights, dispatch, announce],
  );

  // ---- updateNote ----
  const updateNote = useCallback(
    async (id: string, note: string | null): Promise<boolean> => {
      const prev = findHighlight(highlights, id);
      if (!prev) return false;
      dispatch({ type: "UPDATE", id, patch: { note } });
      if (isOptimisticId(id)) {
        const pending = pendingCreates.current.get(id);
        if (!pending) {
          dispatch({ type: "UPDATE", id, patch: { note: prev.note } });
          announce("Failed to save note offline");
          return false;
        }
        const result = await queueMutation({
          type: "highlight.note",
          endpoint: readerHighlightsEndpoint(articleId),
          method: "PATCH",
          body: {
            ...pendingAnchor(pending.input),
            note,
            baseNote: pending.input.note ?? null,
          },
          dedupeKey: `hl-note:${pending.clientMutationId}`,
          dependsOnClientMutationId: pending.clientMutationId,
          generation: pending.generation,
        });
        if (result.queued) {
          announce("Note saved offline");
          return true;
        }
        dispatch({ type: "UPDATE", id, patch: { note: prev.note } });
        announce("Failed to save note offline");
        return false;
      }
      const generation = captureOfflineMutationGeneration();
      if (
        !generation.actorId ||
        !isOfflineMutationGenerationCurrent(generation)
      ) {
        dispatch({ type: "UPDATE", id, patch: { note: prev.note } });
        announce("Failed to save note");
        return false;
      }
      // RW-043 — send the updatedAt we based this edit on so the server can
      // detect a concurrent change and MERGE (never silently drop note text).
      const body = { note, baseUpdatedAt: prev.updatedAt };
      try {
        const res = await fetch(highlightEndpoint(id), {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            [OFFLINE_ACTOR_HEADER]: generation.actorId,
          },
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
        return true;
      } catch {
        // Offline — queue and keep the optimistic note (RW-042/RW-043).
        const result = await submitMutation({
          type: "highlight.note",
          endpoint: highlightEndpoint(id),
          method: "PATCH",
          body,
          dedupeKey: `hl-note:${id}`,
          generation,
        });
        if (result.sent || result.queued) {
          announce(result.sent ? "Note saved" : "Note saved offline");
          return true;
        } else {
          dispatch({ type: "UPDATE", id, patch: { note: prev.note } });
          announce("Failed to save note offline");
          return false;
        }
      }
    },
    [articleId, highlights, dispatch, announce],
  );

  // ---- remove ----
  const remove = useCallback(
    async (id: string, options?: RemoveHighlightOptions): Promise<void> => {
      const existing = findHighlight(highlights, id);
      if (!existing) return;
      dispatch({ type: "REMOVE", id });
      const replacementDependency = options?.dependsOnHighlightId
        ? pendingCreates.current.get(options.dependsOnHighlightId)
        : undefined;
      if (isOptimisticId(id)) {
        const pending = pendingCreates.current.get(id);
        if (pending) {
          const deleteMutationId = newClientMutationId();
          const anchorKey = pendingAnchorKey(articleId, pending.input);
          const completion = queueMutation({
            type: "highlight.delete",
            endpoint: pendingAnchorDeleteEndpoint(articleId, pending.input),
            method: "DELETE",
            clientMutationId: deleteMutationId,
            dedupeKey: `hl-delete:${pending.clientMutationId}`,
            dependsOnClientMutationIds: [
              pending.clientMutationId,
              ...(replacementDependency
                ? [replacementDependency.clientMutationId]
                : []),
            ],
            generation: pending.generation,
          });
          const pendingDelete = {
            clientMutationId: deleteMutationId,
            completion,
          };
          pendingDeletes.current.set(anchorKey, pendingDelete);
          const result = await completion;
          if (result.queued) {
            pendingCreates.current.delete(id);
            announce("Highlight deleted offline");
            return;
          }
          if (pendingDeletes.current.get(anchorKey) === pendingDelete) {
            pendingDeletes.current.delete(anchorKey);
          }
        }
        dispatch({ type: "ADD_OPTIMISTIC", optimistic: existing });
        announce("Failed to delete offline highlight");
        return;
      }

      if (replacementDependency) {
        const deleteMutationId = newClientMutationId();
        const anchorKey = pendingAnchorKey(articleId, existing);
        const completion = queueMutation({
          type: "highlight.delete",
          endpoint: highlightEndpoint(id),
          method: "DELETE",
          clientMutationId: deleteMutationId,
          dedupeKey: `hl-delete:${id}`,
          dependsOnClientMutationId: replacementDependency.clientMutationId,
          generation: replacementDependency.generation,
        });
        const pendingDelete = {
          clientMutationId: deleteMutationId,
          completion,
        };
        pendingDeletes.current.set(anchorKey, pendingDelete);
        const result = await completion;
        if (result.queued) {
          announce("Highlight deletion saved offline");
          return;
        }
        if (pendingDeletes.current.get(anchorKey) === pendingDelete) {
          pendingDeletes.current.delete(anchorKey);
        }
        dispatch({ type: "ADD_OPTIMISTIC", optimistic: existing });
        announce("Failed to save highlight deletion offline");
        return;
      }
      const deleteMutationId = newClientMutationId();
      const anchorKey = pendingAnchorKey(articleId, existing);
      const completion = submitMutation({
        type: "highlight.delete",
        endpoint: highlightEndpoint(id),
        method: "DELETE",
        clientMutationId: deleteMutationId,
        dedupeKey: `hl-delete:${id}`,
      });
      const pendingDelete = {
        clientMutationId: deleteMutationId,
        completion,
      };
      pendingDeletes.current.set(anchorKey, pendingDelete);
      const result = await completion;
      if (result.sent) {
        if (pendingDeletes.current.get(anchorKey) === pendingDelete) {
          pendingDeletes.current.delete(anchorKey);
        }
        announce("Highlight deleted");
        return;
      }
      if (result.queued) {
        announce("Highlight deleted offline");
        return;
      }
      if (pendingDeletes.current.get(anchorKey) === pendingDelete) {
        pendingDeletes.current.delete(anchorKey);
      }
      dispatch({ type: "ADD_OPTIMISTIC", optimistic: existing });
      announce("Failed to delete highlight offline");
    },
    [articleId, highlights, dispatch, announce],
  );

  return { loading, add, updateColor, updateNote, remove };
}
