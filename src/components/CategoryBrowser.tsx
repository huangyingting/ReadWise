"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import type { ListingArticle } from "@/lib/articles";
import type { ProgressSummary } from "@/lib/progress";
import { CATEGORIES } from "@/lib/categories";
import ArticleCardView from "@/components/ArticleCardView";
import ListingProgressSync from "@/components/ListingProgressSync";

type Tab = { key: string; label: string; href: string };

/** Active view: "all", "picks", or a category slug. */
export type BrowseView = string;

type FeedResponse = {
  articles?: ListingArticle[];
  progress?: Record<string, ProgressSummary>;
  hasMore?: boolean;
  offset?: number;
};

function buildTabs(): Tab[] {
  return [
    { key: "all", label: "All", href: "/browse" },
    ...CATEGORIES.map((c) => ({
      key: c.slug,
      label: c.label,
      href: `/browse?category=${c.slug}`,
    })),
    { key: "picks", label: "Picks", href: "/browse?view=picks" },
  ];
}

function queryFor(view: BrowseView, offset: number): string {
  const params = new URLSearchParams({ offset: String(offset), limit: "6" });
  if (view === "picks") {
    params.set("view", "picks");
  } else if (view !== "all") {
    params.set("category", view);
  }
  return params.toString();
}

/**
 * Category browsing homepage feed. Renders the category tab bar (each tab is a
 * URL-reflected link), an initial server-rendered page of cards, and a
 * "Load more" control that incrementally fetches and appends the next page.
 */
export default function CategoryBrowser({
  activeView,
  initialArticles,
  initialProgress,
  initialHasMore,
  initialOffset,
}: {
  activeView: BrowseView;
  initialArticles: ListingArticle[];
  initialProgress: Record<string, ProgressSummary>;
  initialHasMore: boolean;
  initialOffset: number;
}) {
  const [articles, setArticles] = useState<ListingArticle[]>(initialArticles);
  const [progress, setProgress] = useState<Record<string, ProgressSummary>>(initialProgress);
  const [offset, setOffset] = useState<number>(initialOffset);
  const [hasMore, setHasMore] = useState<boolean>(initialHasMore);
  const [loading, setLoading] = useState<boolean>(false);

  const tabs = buildTabs();

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/articles?${queryFor(activeView, offset)}`);
      if (!res.ok) {
        return;
      }
      const data = (await res.json()) as FeedResponse;
      const next = data.articles ?? [];
      setArticles((prev) => {
        const seen = new Set(prev.map((a) => a.id));
        return [...prev, ...next.filter((a) => !seen.has(a.id))];
      });
      setProgress((prev) => ({ ...prev, ...(data.progress ?? {}) }));
      setOffset(data.offset ?? offset + next.length);
      setHasMore(Boolean(data.hasMore));
    } catch {
      /* best-effort; keep what we have */
    } finally {
      setLoading(false);
    }
  }, [activeView, offset, hasMore, loading]);

  return (
    <div>
      <nav className="category-tabs" aria-label="Categories">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={`category-tab${tab.key === activeView ? " category-tab--active" : ""}`}
            aria-current={tab.key === activeView ? "page" : undefined}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {articles.length === 0 ? (
        <p className="muted" style={{ marginTop: "1.5rem" }}>
          {activeView === "picks"
            ? "No picks for you yet — check back once more articles are available."
            : "No articles in this category yet."}
        </p>
      ) : (
        <>
          <div className="article-grid">
            {articles.map((article) => (
              <ArticleCardView
                key={article.id}
                article={article}
                progress={progress[article.id]}
              />
            ))}
          </div>
          {hasMore ? (
            <div style={{ marginTop: "1.5rem", textAlign: "center" }}>
              <button
                type="button"
                className="btn"
                onClick={() => void loadMore()}
                disabled={loading}
              >
                {loading ? "Loading…" : "Load more"}
              </button>
            </div>
          ) : null}
        </>
      )}

      <ListingProgressSync articleIds={articles.map((a) => a.id)} />
    </div>
  );
}
