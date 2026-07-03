"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { postJson } from "@/lib/client-fetch";

export type VocabularyItem = {
  word: string;
  explanation: string;
  example: string;
  saved: boolean;
  frequencyTier: import("@/lib/option-registries").FrequencyTier | null;
};

type VocabularyResponse = {
  articleId: string;
  items: VocabularyItem[];
  fallback: boolean;
};

const VOCABULARY_LOAD_ERROR = "Could not load vocabulary";
const VOCABULARY_UPDATE_ERROR = "Could not update study list";

export type UseArticleVocabularyPanelResult = {
  loading: boolean;
  loaded: boolean;
  error: string | null;
  fallback: boolean;
  items: VocabularyItem[];
  pending: string | null;
  toggleSaved: (item: VocabularyItem) => void;
  retry: () => void;
};

function getErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function getSavedMutationEndpoint(saved: boolean): string {
  return saved ? "/api/vocabulary/unsave" : "/api/vocabulary/save";
}

/**
 * useArticleVocabularyPanel
 *
 * Data hook for the vocabulary study panel. Handles:
 *   - One-shot lazy fetch on first mount
 *   - Loading / error / fallback state
 *   - Save / unsave mutation with per-word pending guard
 */
export function useArticleVocabularyPanel(
  articleId: string,
): UseArticleVocabularyPanelResult {
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  const [items, setItems] = useState<VocabularyItem[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const hasFetched = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await postJson<VocabularyResponse>(
        `/api/reader/${articleId}/vocabulary`,
        {},
      );
      setItems(data.items);
      setFallback(data.fallback);
      setLoaded(true);
    } catch (err) {
      setError(getErrorMessage(err, VOCABULARY_LOAD_ERROR));
    } finally {
      setLoading(false);
    }
  }, [articleId]);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    void load();
  }, [load]);

  const toggleSaved = useCallback(
    (item: VocabularyItem) => {
      if (pending) return;
      setPending(item.word);
      setError(null);
      void postJson(getSavedMutationEndpoint(item.saved), {
        word: item.word,
        explanation: item.explanation,
        example: item.example,
        articleId,
      })
        .then(() => {
          setItems((prev) =>
            prev.map((it) =>
              it.word === item.word ? { ...it, saved: !it.saved } : it,
            ),
          );
        })
        .catch((err: unknown) => {
          setError(getErrorMessage(err, VOCABULARY_UPDATE_ERROR));
        })
        .finally(() => {
          setPending(null);
        });
    },
    [articleId, pending],
  );

  return {
    loading,
    loaded,
    error,
    fallback,
    items,
    pending,
    toggleSaved,
    retry: load,
  };
}
