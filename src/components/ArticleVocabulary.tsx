"use client";

import { useState } from "react";

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

export default function ArticleVocabulary({
  articleId,
}: {
  articleId: string;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  const [items, setItems] = useState<VocabularyItem[]>([]);
  const [pending, setPending] = useState<string | null>(null);

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

  function handleToggleOpen() {
    const next = !open;
    setOpen(next);
    if (next && !loaded && !loading) {
      void loadVocabulary();
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
    <section className="vocabulary" aria-label="Vocabulary">
      <div className="vocabulary-controls">
        <h2 className="vocabulary-heading">Vocabulary</h2>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleToggleOpen}
          aria-expanded={open}
        >
          {open ? "Hide vocabulary" : "Show vocabulary"}
        </button>
      </div>

      {open ? (
        <div className="vocabulary-panel" role="region" aria-label="Article vocabulary">
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
                        “{item.example}”
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
      ) : null}
    </section>
  );
}
