"use client";

import { useCallback, useRef, useState } from "react";
import type { RefObject } from "react";
import type { DictionaryResult } from "@/lib/lexical/provider";
import { extractContextSentence } from "./selectionHelpers";

/**
 * Manages the save/unsave vocabulary state for the dictionary popover.
 *
 * Maintains a session-level cache (savedCacheRef) so that re-opening the
 * dictionary for a previously viewed word does not require a server round-trip.
 */
export function useSaveWord(
  word: string,
  result: DictionaryResult | null,
  articleId: string,
  proseRef: RefObject<HTMLElement | null>,
) {
  const [wordSaved, setWordSaved] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savedCacheRef = useRef<Map<string, boolean>>(new Map());

  /**
   * Should be called when the dictionary is opened for a new word. Restores
   * the saved state from the session cache so the button reflects the correct
   * initial state without a network request.
   */
  const openForWord = useCallback(
    (candidate: string) => {
      setSaveError(null);
      const cached = savedCacheRef.current.get(candidate.toLowerCase());
      setWordSaved(cached ?? false);
    },
    [],
  );

  /** Clears error and pending flags; called by the global closeAll handler. */
  const resetSaveError = useCallback(() => {
    setSaveError(null);
    setSavePending(false);
  }, []);

  /** Toggles the saved state with an optimistic update, reverting on error. */
  const handleToggleSave = useCallback(async () => {
    if (savePending) return;
    setSavePending(true);
    setSaveError(null);

    const isSaved = wordSaved;
    // Optimistic update
    setWordSaved(!isSaved);
    savedCacheRef.current.set(word.toLowerCase(), !isSaved);

    try {
      const endpoint = isSaved ? "/api/vocabulary/unsave" : "/api/vocabulary/save";
      const body: Record<string, unknown> = { word };

      if (!isSaved) {
        const firstMeaning = result?.found ? result.meanings[0] : null;
        const firstDef = firstMeaning?.definitions[0];
        if (firstDef?.definition) {
          body.explanation = `(${firstMeaning!.partOfSpeech}) ${firstDef.definition}`;
        }
        if (firstDef?.example) {
          body.example = firstDef.example;
        }
        const prose = proseRef.current;
        if (prose) {
          const ctx = extractContextSentence(prose, word);
          if (ctx) body.contextSentence = ctx;
        }
        body.articleId = articleId;
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(d?.error ?? "Could not update study list");
      }
    } catch (err) {
      // Revert on error
      setWordSaved(isSaved);
      savedCacheRef.current.set(word.toLowerCase(), isSaved);
      setSaveError(
        err instanceof Error ? err.message : "Could not update study list",
      );
    } finally {
      setSavePending(false);
    }
  }, [savePending, wordSaved, word, result, articleId, proseRef]);

  return {
    wordSaved,
    savePending,
    saveError,
    openForWord,
    resetSaveError,
    handleToggleSave,
  };
}
