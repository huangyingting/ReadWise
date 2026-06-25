"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Inbox, Sparkles } from "lucide-react";
import { useCallback, useState } from "react";
import type { ListingArticle } from "@/lib/article-library";
import type { ProgressSummary } from "@/lib/progress";
import { CATEGORIES } from "@/lib/categories";
import { ENGLISH_LEVELS } from "@/lib/option-registries";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { cn, focusRing } from "@/lib/cn";
import ArticleCardView from "@/components/ArticleCardView";
import ListingSync from "@/components/ListingSync";
import EmptyState from "@/components/EmptyState";
import { useLoadMoreList } from "@/hooks/useLoadMoreList";

type Tab = { key: string; label: string; href: string };

/** Active view: "all", "picks", or a category slug. */
export type BrowseView = string;

type FeedResponse = {
  articles?: ListingArticle[];
  progress?: Record<string, ProgressSummary>;
  hasMore?: boolean;
  offset?: number;
};

function buildTabs(level: string | null): Tab[] {
  const levelSuffix = level ? `&level=${level}` : "";
  return [
    { key: "all", label: "All", href: `/browse${level ? `?level=${level}` : ""}` },
    ...CATEGORIES.map((c) => ({
      key: c.slug,
      label: c.label,
      href: `/browse?category=${c.slug}${levelSuffix}`,
    })),
    { key: "picks", label: "Picks", href: `/browse?view=picks${levelSuffix}` },
  ];
}

function queryFor(view: BrowseView, offset: number, level: string | null): string {
  const params = new URLSearchParams({ offset: String(offset), limit: "6" });
  if (view === "picks") {
    params.set("view", "picks");
  } else if (view !== "all") {
    params.set("category", view);
  }
  if (level) {
    params.set("level", level);
  }
  return params.toString();
}

/**
 * Category browsing homepage feed. Renders the category tab bar (each tab is a
 * URL-reflected link), an optional CEFR level filter, an initial server-rendered
 * page of cards, and a "Load more" control that incrementally fetches and appends
 * the next page.
 */
export default function CategoryBrowser({
  activeView,
  initialArticles,
  initialProgress,
  initialHasMore,
  initialOffset,
  heading,
  initialSavedIds,
  initialLevel,
}: {
  activeView: BrowseView;
  initialArticles: ListingArticle[];
  initialProgress: Record<string, ProgressSummary>;
  initialHasMore: boolean;
  initialOffset: number;
  heading: string;
  /** SSR initial set of saved article ids — for the card bookmark overlay. */
  initialSavedIds?: string[];
  /** Active CEFR level filter from the URL (e.g. "B1") or null. */
  initialLevel?: string | null;
}) {
  const router = useRouter();
  const [savedIds] = useState<Set<string>>(() => new Set(initialSavedIds ?? []));

  const level = initialLevel ?? null;
  const tabs = buildTabs(level);

  const fetchPage = useCallback(
    async (nextOffset: number): Promise<FeedResponse> => {
      const res = await fetch(
        `/api/articles?${queryFor(activeView, nextOffset, level)}`,
      );
      if (!res.ok) throw new Error("fetch failed");
      return (await res.json()) as FeedResponse;
    },
    [activeView, level],
  );

  const { articles, progress, hasMore, loading, loadError, loadMore } =
    useLoadMoreList({
      initialArticles,
      initialProgress,
      initialHasMore,
      initialOffset,
      fetchPage,
    });

  function handleLevelChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newLevel = e.target.value || null;
    // Build the new URL preserving the current view/category.
    const params = new URLSearchParams();
    if (activeView === "picks") {
      params.set("view", "picks");
    } else if (activeView !== "all") {
      params.set("category", activeView);
    }
    if (newLevel) {
      params.set("level", newLevel);
    }
    const qs = params.toString();
    router.push(`/browse${qs ? `?${qs}` : ""}`);
  }

  return (
    <div>
      {/* Category tab bar — §2.6; gradient affordance shows scroll on mobile */}
      <div className="category-tabs-wrapper">
        <nav
          className="flex flex-nowrap overflow-x-auto items-center gap-[var(--space-2)] mt-[var(--space-5)] mb-[var(--space-3)] pb-[var(--space-1)]"
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
      </div>

      {/* Level filter row */}
      <div className="flex items-center gap-[var(--space-2)] mb-[var(--space-5)]">
        <label
          htmlFor="browse-level-filter"
          className="text-text-muted text-[length:var(--text-sm)] whitespace-nowrap"
        >
          Level
        </label>
        <div className="w-36">
          <Select
            id="browse-level-filter"
            value={level ?? ""}
            onChange={handleLevelChange}
            selectSize="sm"
            aria-label="Filter articles by CEFR level"
          >
            <option value="">All levels</option>
            {ENGLISH_LEVELS.map((lvl) => (
              <option key={lvl} value={lvl}>
                {lvl} and below
              </option>
            ))}
          </Select>
        </div>
      </div>

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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-[var(--space-4)] sm:gap-[var(--space-5)] lg:gap-[var(--space-5)] rw-fade-up">
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
                onClick={() => void loadMore()}
              >
                {loadError ? "Retry" : "Load more"}
              </Button>
            </div>
          ) : null}
        </>
      )}

      <ListingSync articleIds={articles.map((a) => a.id)} />
    </div>
  );
}
