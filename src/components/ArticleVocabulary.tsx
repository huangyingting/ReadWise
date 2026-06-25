"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, CircleOff } from "lucide-react";
import { postJson } from "@/lib/client-fetch";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { TIER_LABELS, TIER_VARIANTS, type FrequencyTier } from "@/lib/option-registries";
import AiBadge from "@/components/AiBadge";

type VocabularyItem = {
  word: string;
  explanation: string;
  example: string;
  saved: boolean;
  frequencyTier: FrequencyTier | null;
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
      await postJson(endpoint, {
        word: item.word,
        explanation: item.explanation,
        example: item.example,
        articleId,
      });
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
      {loading ? (
        <div className="reader-tools-panel-state" role="status">
          <Spinner size="lg" />
          <p className="muted">Extracting key words…</p>
        </div>
      ) : null}

      {error ? (
        <p className="vocabulary-error" role="alert">
          {error}
        </p>
      ) : null}

      {!loading && loaded && fallback ? (
        <div className="reader-tools-panel-state">
          <CircleOff size={28} className="text-text-subtle" aria-hidden />
          <p className="font-semibold m-0">Vocabulary unavailable</p>
          <p className="muted m-0 max-w-[40ch]">
            AI vocabulary extraction is not available right now. Please try again
            later.
          </p>
        </div>
      ) : null}

      {!loading && loaded && !fallback && items.length === 0 ? (
        <div className="reader-tools-panel-state">
          <BookOpen size={28} className="text-text-subtle" aria-hidden />
          <p className="font-semibold m-0">No vocabulary found</p>
          <p className="muted m-0 max-w-[40ch]">
            We couldn&rsquo;t pull key words from this article.
          </p>
        </div>
      ) : null}

      {items.length > 0 ? (
        <>
          <div style={{ marginBottom: "var(--space-3)" }}>
            <AiBadge />
          </div>
          <ul className="vocabulary-list">
          {items.map((item) => {
            const tier = item.frequencyTier;
            return (
              <li key={item.word} className="vocabulary-item">
                <div className="vocabulary-item-main">
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
                    <strong className="vocabulary-word">{item.word}</strong>
                    {tier ? (
                      <Badge
                        variant={TIER_VARIANTS[tier]}
                        aria-label={`Word frequency: ${TIER_LABELS[tier]}`}
                        style={{ fontSize: "0.7rem", padding: "1px 6px" }}
                      >
                        {TIER_LABELS[tier]}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="vocabulary-explanation">{item.explanation}</p>
                  {item.example ? (
                    <p className="vocabulary-example muted">
                      &ldquo;{item.example}&rdquo;
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant={item.saved ? "outline" : "secondary"}
                  size="sm"
                  onClick={() => toggleSaved(item)}
                  disabled={pending === item.word}
                  aria-pressed={item.saved}
                  aria-label={item.saved ? `Remove saved word: ${item.word}` : `Save word: ${item.word}`}
                >
                  {pending === item.word
                    ? "…"
                    : item.saved
                    ? "✓ Saved"
                    : "Save"}
                </Button>
              </li>
            );
          })}
        </ul>
        </>
      ) : null}
    </div>
  );
}
