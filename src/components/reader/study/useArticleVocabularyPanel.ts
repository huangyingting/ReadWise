"use client";

import { useEffect, useRef, useState } from "react";
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

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
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
      setError(err instanceof Error ? err.message : "Could not load vocabulary");
    } finally {
      setLoading(false);
    }
  }

  function toggleSaved(item: VocabularyItem) {
    if (pending) return;
    setPending(item.word);
    setError(null);
    const endpoint = item.saved
      ? "/api/vocabulary/unsave"
      : "/api/vocabulary/save";
    void postJson(endpoint, {
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
        setError(
          err instanceof Error ? err.message : "Could not update study list",
        );
      })
      .finally(() => {
        setPending(null);
      });
  }

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
