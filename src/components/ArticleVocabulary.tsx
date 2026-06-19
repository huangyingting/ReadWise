"use client";

import { useEffect, useRef, useState } from "react";

type VocabularyItem = {
  word: string;
  explanation: string;
  example: string;
  saved: boolean;
};

type VocabularyResponse = {
  articleId: string;
  items: VocabularyItem[];
  fallback: boolean;
};

/**
 * ArticleVocabulary (M5 refactor)
 *
 * Stripped of its own open/close toggle. Fetches on first mount
 * (= first Words-tab activation). Inner UI/save toggle unchanged.
 *
 * Props:
 *   articleId — the article to extract vocabulary for
 *   active    — true when the Words tab is the currently visible panel
 *               (unused for scroll; kept for API consistency with other panels)
 */
export default function ArticleVocabulary({
  articleId,
}: {
  articleId: string;
  active: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  const [items, setItems] = useState<VocabularyItem[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const hasFetched = useRef(false);

  // Fetch once on first mount (first Words-tab activation).
  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    void loadVocabulary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadVocabulary() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reader/${articleId}/vocabulary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? "Could not load vocabulary");
      }
      const data = (await res.json()) as VocabularyResponse;
      setItems(data.items);
      setFallback(data.fallback);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load vocabulary");
    } finally {
      setLoading(false);
    }
  }

  async function toggleSaved(item: VocabularyItem) {
    if (pending) {
      return;
    }
    setPending(item.word);
    setError(null);
    const endpoint = item.saved
      ? "/api/vocabulary/unsave"
      : "/api/vocabulary/save";
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: item.word,
          explanation: item.explanation,
          example: item.example,
          articleId,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? "Could not update study list");
      }
      setItems((prev) =>
        prev.map((it) =>
          it.word === item.word ? { ...it, saved: !it.saved } : it,
        ),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update study list",
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="vocabulary-panel">
      {loading ? <p className="muted">Extracting key words…</p> : null}

      {error ? (
        <p className="vocabulary-error" role="alert">
          {error}
        </p>
      ) : null}

      {!loading && loaded && fallback ? (
        <p className="muted">
          Vocabulary extraction is unavailable right now. Please try again
          later.
        </p>
      ) : null}

      {!loading && loaded && !fallback && items.length === 0 ? (
        <p className="muted">No vocabulary found for this article.</p>
      ) : null}

      {items.length > 0 ? (
        <ul className="vocabulary-list">
          {items.map((item) => (
            <li key={item.word} className="vocabulary-item">
              <div className="vocabulary-item-main">
                <strong className="vocabulary-word">{item.word}</strong>
                <p className="vocabulary-explanation">{item.explanation}</p>
                {item.example ? (
                  <p className="vocabulary-example muted">
                    &ldquo;{item.example}&rdquo;
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                className={`btn vocabulary-save ${
                  item.saved ? "is-saved" : ""
                }`}
                onClick={() => toggleSaved(item)}
                disabled={pending === item.word}
                aria-pressed={item.saved}
              >
                {pending === item.word
                  ? "…"
                  : item.saved
                    ? "✓ Saved"
                    : "Save"}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

