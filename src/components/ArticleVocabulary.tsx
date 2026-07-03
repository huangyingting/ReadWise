"use client";

import { Badge, Button, Inline } from "@/components/ui";
import { TIER_LABELS, TIER_VARIANTS } from "@/lib/option-registries";
import AiBadge from "@/components/AiBadge";
import { t } from "@/lib/i18n";
import {
  PanelLoading,
  PanelError,
  PanelFallback,
  PanelEmpty,
} from "@/components/ui/ReaderToolPanelState";
import {
  useArticleVocabularyPanel,
  type VocabularyItem,
} from "@/components/reader/study/useArticleVocabularyPanel";

/**
 * ArticleVocabulary (M5 refactor, REF-062 split)
 *
 * Thin composition: data/mutation state lives in useArticleVocabularyPanel;
 * this file owns only the rendered output.
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
  const { loading, loaded, error, fallback, items, pending, toggleSaved } =
    useArticleVocabularyPanel(articleId);
  const showFallback = !loading && loaded && fallback;
  const showEmpty = !loading && loaded && !fallback && items.length === 0;
  const hasItems = items.length > 0;

  return (
    <div className="vocabulary-panel">
      {loading ? <PanelLoading message="Extracting key words…" /> : null}

      {error ? <PanelError message={error} /> : null}

      {showFallback ? (
        <PanelFallback
          title={t("ai.vocabulary.unavailable.title")}
          description={t("ai.vocabulary.unavailable.description")}
        />
      ) : null}

      {showEmpty ? (
        <PanelEmpty
          title="No vocabulary found"
          description={<>We couldn&rsquo;t pull key words from this article.</>}
        />
      ) : null}

      {hasItems ? (
        <>
          <div className="mb-[var(--space-3)]">
            <AiBadge />
          </div>
          <ul className="vocabulary-list">
            {items.map((item) => (
              <VocabularyListItem
                key={item.word}
                item={item}
                pending={pending}
                onToggle={toggleSaved}
              />
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

// ─── Presentational sub-component ─────────────────────────────────────────────

function VocabularyListItem({
  item,
  pending,
  onToggle,
}: {
  item: VocabularyItem;
  pending: string | null;
  onToggle: (item: VocabularyItem) => void;
}) {
  const tier = item.frequencyTier;
  const pendingThisWord = pending === item.word;
  const saveLabel = item.saved
    ? `Remove saved word: ${item.word}`
    : `Save word: ${item.word}`;

  return (
    <li className="vocabulary-item">
      <div className="vocabulary-item-main">
        <Inline gap="2">
          <strong className="vocabulary-word">{item.word}</strong>
          {tier ? (
            <Badge
              variant={TIER_VARIANTS[tier]}
              aria-label={`Word frequency: ${TIER_LABELS[tier]}`}
            >
              {TIER_LABELS[tier]}
            </Badge>
          ) : null}
        </Inline>
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
        onClick={() => onToggle(item)}
        disabled={pendingThisWord}
        aria-pressed={item.saved}
        aria-label={saveLabel}
      >
        {pendingThisWord ? "…" : item.saved ? "✓ Saved" : "Save"}
      </Button>
    </li>
  );
}
