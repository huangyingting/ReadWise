"use client";

import { useCallback, useRef, useState } from "react";
import type { RefObject } from "react";
import type { DictionaryResult } from "@/lib/lexical/provider";
import { clientErrorMessage, postJson } from "@/lib/client-fetch";
import { extractContextSentence } from "./selectionHelpers";

const SAVE_ENDPOINT = "/api/vocabulary/save";
const UNSAVE_ENDPOINT = "/api/vocabulary/unsave";
const DEFAULT_SAVE_ERROR = "Could not update study list";

function cacheKey(word: string) {
  return word.toLowerCase();
}

function applyDefinitionDetails(
  body: Record<string, unknown>,
  result: DictionaryResult | null,
) {
  const firstMeaning = result?.found ? result.meanings[0] : null;
  const firstDefinition = firstMeaning?.definitions[0];

  if (firstMeaning && firstDefinition?.definition) {
    body.explanation = `(${firstMeaning.partOfSpeech}) ${firstDefinition.definition}`;
  }
  if (firstDefinition?.example) {
    body.example = firstDefinition.example;
  }
}

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
      const cached = savedCacheRef.current.get(cacheKey(candidate));
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
    savedCacheRef.current.set(cacheKey(word), !isSaved);

    try {
      const endpoint = isSaved ? UNSAVE_ENDPOINT : SAVE_ENDPOINT;
      const body: Record<string, unknown> = { word };

      if (!isSaved) {
        applyDefinitionDetails(body, result);
        const prose = proseRef.current;
        if (prose) {
          const ctx = extractContextSentence(prose, word);
          if (ctx) body.contextSentence = ctx;
        }
        body.articleId = articleId;
      }

      await postJson(endpoint, body);
    } catch (err) {
      // Revert on error
      setWordSaved(isSaved);
      savedCacheRef.current.set(cacheKey(word), isSaved);
      setSaveError(clientErrorMessage(err, DEFAULT_SAVE_ERROR));
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
