"use client";

import type { ReactNode } from "react";
import type { ListingArticle } from "@/lib/article-library";
import type { ProgressSummary } from "@/lib/engagement/progress";
import { Button } from "@/components/ui/Button";
import ArticleCardView from "@/components/ArticleCardView";
import ListingSync from "@/components/ListingSync";

/**
 * ArticleListingGrid — shared card-grid + load-more + ListingSync shell for
 * listing feeds (REF/FE-4). Extracted from the duplicated markup in
 * CategoryBrowser and ForYouFeed so both become thin wrappers over
 * {@link useLoadMoreList}.
 *
 * Pairs with useLoadMoreList: spread its `articles`/`progress`/`hasMore`/
 * `loading`/`loadError` result and wire `loadMore` to `onLoadMore`. The card
 * grid markup and the Load-more / error control are kept byte-identical to the
 * originals so there is no visual or DOM-contract change.
 *
 * Slots for feed-specific differences:
 *   - `empty`     — rendered in place of the grid when there are no articles.
 *   - `beforeGrid`— extra node above the grid (e.g. ForYouFeed live region).
 *   - `endCap`    — replaces the Load-more control when `hasMore` is false
 *                   (e.g. ForYouFeed "you're all caught up" cap).
 *   - `reasons`   — per-article personalisation reason passed to each card.
 */
export interface ArticleListingGridProps {
  articles: ListingArticle[];
  progress: Record<string, ProgressSummary>;
  /** SSR initial set of saved article ids — drives the card bookmark overlay. */
  savedIds: Set<string>;
  hasMore: boolean;
  loading: boolean;
  loadError: string | null;
  onLoadMore: () => void;
  /** Per-article personalisation reason keyed by articleId (optional). */
  reasons?: Record<string, string>;
  /** Rendered instead of the grid when `articles` is empty. */
  empty?: ReactNode;
  /** Extra node rendered above the grid (only in the non-empty path). */
  beforeGrid?: ReactNode;
  /** Replaces the Load-more control when `hasMore` is false. */
  endCap?: ReactNode;
}

export default function ArticleListingGrid({
  articles,
  progress,
  savedIds,
  hasMore,
  loading,
  loadError,
  onLoadMore,
  reasons,
  empty,
  beforeGrid,
  endCap,
}: ArticleListingGridProps) {
  const articleIds = articles.map((a) => a.id);

  if (articles.length === 0 && empty != null) {
    return (
      <>
        {empty}
        <ListingSync articleIds={articleIds} />
      </>
    );
  }

  return (
    <>
      {beforeGrid}

      {/* Card grid — identical markup to M4 listings */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-[var(--space-4)] sm:gap-[var(--space-5)] lg:gap-[var(--space-5)] rw-fade-up">
        {articles.map((article) => (
          <ArticleCardView
            key={article.id}
            article={article}
            progress={progress[article.id]}
            saved={savedIds.has(article.id)}
            reason={reasons?.[article.id]}
          />
        ))}
      </div>

      {/* Load more / end-cap */}
      {hasMore ? (
        <div className="mt-[var(--space-7)] flex flex-col items-center gap-[var(--space-3)]">
          {loadError ? (
            <p
              role="alert"
              className="text-[length:var(--text-sm)] text-danger-text m-0 text-center"
            >
              {loadError}
            </p>
          ) : null}
          <Button
            variant="secondary"
            size="md"
            loading={loading}
            onClick={onLoadMore}
          >
            {loadError ? "Retry" : "Load more"}
          </Button>
        </div>
      ) : (
        endCap ?? null
      )}

      {/* Progress + bookmark sync over the growing article id set */}
      <ListingSync articleIds={articleIds} />
    </>
  );
}
