"use client";

import Link from "next/link";
import { Inbox, Sparkles } from "lucide-react";
import { useCallback, useState } from "react";
import type { ListingArticle } from "@/lib/articles";
import type { ProgressSummary } from "@/lib/progress";
import { CATEGORIES } from "@/lib/categories";
import { Button } from "@/components/ui/Button";
import { cn, focusRing } from "@/lib/cn";
import ArticleCardView from "@/components/ArticleCardView";
import ListingProgressSync from "@/components/ListingProgressSync";
import ListingBookmarkSync from "@/components/ListingBookmarkSync";
import EmptyState from "@/components/EmptyState";

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
  heading,
  initialSavedIds,
}: {
  activeView: BrowseView;
  initialArticles: ListingArticle[];
  initialProgress: Record<string, ProgressSummary>;
  initialHasMore: boolean;
  initialOffset: number;
  heading: string;
  /** SSR initial set of saved article ids — for the card bookmark overlay. */
  initialSavedIds?: string[];
}) {
  const [articles, setArticles] = useState<ListingArticle[]>(initialArticles);
  const [progress, setProgress] = useState<Record<string, ProgressSummary>>(initialProgress);
  const [savedIds] = useState<Set<string>>(() => new Set(initialSavedIds ?? []));
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
      {/* Category tab bar — §2.6 */}
      <nav
        className="flex flex-nowrap overflow-x-auto items-center gap-[var(--space-2)] mt-[var(--space-5)] mb-[var(--space-6)] pb-[var(--space-1)]"
        style={{ scrollbarWidth: "thin", scrollbarColor: "var(--border) transparent" }}
        aria-label="Categories"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={tab.key === activeView ? "page" : undefined}
            className={cn(
              "inline-flex items-center shrink-0",
              "h-9 px-[var(--space-4)]",
              "rounded-[var(--radius-full)]",
              "text-[length:var(--text-sm)] font-medium",
              "no-underline",
              "transition-colors [transition-duration:var(--duration-fast)]",
              tab.key === activeView
                ? "bg-primary border border-primary text-on-primary"
                : "bg-surface border border-border text-text-muted hover:border-border-strong hover:text-text hover:bg-bg-subtle",
              focusRing,
            )}
          >
            {tab.label}
          </Link>
        ))}
        {/* Search slot reserved for M9 */}
      </nav>

      {/* Section heading */}
      <h2
        className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text mt-0 mb-[var(--space-4)]"
      >
        {heading}
      </h2>

      {articles.length === 0 ? (
        activeView === "picks" ? (
          <EmptyState
            icon={Sparkles}
            title="No picks for you yet"
            description="Read a few articles and we'll tailor recommendations to your level and topics."
            action={{ label: "Browse all", href: "/browse" }}
          />
        ) : (
          <EmptyState
            icon={Inbox}
            title="This category is empty"
            description="No articles here yet — check another category."
            action={{ label: "Browse all", href: "/browse" }}
          />
        )
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[var(--space-4)] sm:gap-[var(--space-5)] lg:gap-[var(--space-6)] rw-fade-up">
            {articles.map((article) => (
              <ArticleCardView
                key={article.id}
                article={article}
                progress={progress[article.id]}
                saved={savedIds.has(article.id)}
              />
            ))}
          </div>
          {hasMore ? (
            <div className="mt-[var(--space-7)] flex justify-center">
              <Button
                variant="secondary"
                size="md"
                loading={loading}
                onClick={() => void loadMore()}
              >
                Load more
              </Button>
            </div>
          ) : null}
        </>
      )}

      <ListingProgressSync articleIds={articles.map((a) => a.id)} />
      <ListingBookmarkSync articleIds={articles.map((a) => a.id)} />
    </div>
  );
}
