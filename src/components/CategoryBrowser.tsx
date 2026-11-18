"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Inbox, Search, Sparkles, X } from "lucide-react";
import { useCallback, useState, useTransition } from "react";
import type { ListingArticle } from "@/lib/article-library";
import type { ProgressSummary } from "@/lib/engagement";
import { CATEGORIES } from "@/lib/categories";
import { ENGLISH_LEVELS } from "@/lib/option-registries";
import { Button, Input, Label, Select } from "@/components/ui";
import { cn, focusRing } from "@/lib/cn";
import ArticleListingGrid from "@/components/ArticleListingGrid";
import { EmptyState } from "@/components/ui";
import { useLoadMoreList } from "@/hooks/useLoadMoreList";
import { normalizeBrowseQuery } from "@/lib/browse-query";
import { FILTERABLE_MATURITY_BANDS, MATURITY_BAND_LABELS } from "@/lib/article-library/maturity";
import { READING_SKILLS } from "@/lib/learning/reading-skills";

const PAGE_SIZE = 6;

type Tab = { key: string; label: string; href: string };

/** Active view: "all", "picks", or a category slug. */
export type BrowseView = string;

type CategoryBrowserProps = {
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
  /** Active in-context search query from the URL. */
  initialQuery?: string | null;
  /** Active content maturity band filter from the URL (#1302). */
  initialMaturity?: string | null;
  /** Active reading-skill filter from the URL (#1302). */
  initialSkill?: string | null;
};

/** URL-reflected filters shared by tab links, filter changes, and paging. */
type BrowseFilters = {
  level: string | null;
  query: string | null;
  maturity: string | null;
  skill: string | null;
};

type FeedResponse = {
  articles?: ListingArticle[];
  progress?: Record<string, ProgressSummary>;
  hasMore?: boolean;
  offset?: number;
};

function appendViewParam(params: URLSearchParams, view: BrowseView) {
  if (view === "picks") {
    params.set("view", "picks");
  } else if (view !== "all") {
    params.set("category", view);
  }
}

function appendFilterParams(params: URLSearchParams, filters: BrowseFilters) {
  if (filters.level) params.set("level", filters.level);
  const normalized = normalizeBrowseQuery(filters.query);
  if (normalized) params.set("q", normalized);
  if (filters.maturity) params.set("maturity", filters.maturity);
  if (filters.skill) params.set("skill", filters.skill);
}

function browseHrefFor(view: BrowseView, filters: BrowseFilters): string {
  const params = new URLSearchParams();
  appendViewParam(params, view);
  appendFilterParams(params, filters);
  const qs = params.toString();
  return `/browse${qs ? `?${qs}` : ""}`;
}

function buildTabs(filters: BrowseFilters): Tab[] {
  return [
    { key: "all", label: "All", href: browseHrefFor("all", filters) },
    ...CATEGORIES.map((c) => ({
      key: c.slug,
      label: c.label,
      href: browseHrefFor(c.slug, filters),
    })),
    { key: "picks", label: "Picks", href: browseHrefFor("picks", filters) },
  ];
}

function queryFor(view: BrowseView, offset: number, filters: BrowseFilters): string {
  const params = new URLSearchParams({ offset: String(offset), limit: String(PAGE_SIZE) });
  appendViewParam(params, view);
  appendFilterParams(params, filters);
  return params.toString();
}

/**
 * Category browsing homepage feed. Renders the category tab bar (each tab is a
 * URL-reflected link), an optional CEFR level filter, an initial server-rendered
 * page of cards, and a "Load more" control that incrementally fetches and appends
 * the next page.
 *
 * Thin wrapper over {@link useLoadMoreList} + {@link ArticleListingGrid}; the
 * shared grid owns the card markup, the Load-more control, and ListingSync.
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
  initialQuery,
  initialMaturity,
  initialSkill,
}: CategoryBrowserProps) {
  const router = useRouter();
  const [savedIds] = useState<Set<string>>(() => new Set(initialSavedIds ?? []));
  const [searchDraft, setSearchDraft] = useState(initialQuery ?? "");
  const [isPending, startTransition] = useTransition();

  const level = initialLevel ?? null;
  const query = initialQuery ?? null;
  const maturity = initialMaturity ?? null;
  const skill = initialSkill ?? null;
  const filters: BrowseFilters = { level, query, maturity, skill };
  const tabs = buildTabs(filters);

  const fetchPage = useCallback(
    async (nextOffset: number): Promise<FeedResponse> => {
      const res = await fetch(
        `/api/articles?${queryFor(activeView, nextOffset, { level, query, maturity, skill })}`,
      );
      if (!res.ok) throw new Error("fetch failed");
      return (await res.json()) as FeedResponse;
    },
    [activeView, level, query, maturity, skill],
  );

  const { articles, progress, hasMore, loading, loadError, loadMore } =
    useLoadMoreList({
      initialArticles,
      initialProgress,
      initialHasMore,
      initialOffset,
      fetchPage,
    });

  function applyFilters(next: Partial<BrowseFilters>) {
    startTransition(() => {
      router.push(browseHrefFor(activeView, { ...filters, ...next }));
    });
  }

  function handleSearchSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    applyFilters({ query: normalizeBrowseQuery(searchDraft) });
  }

  function handleSearchClear() {
    setSearchDraft("");
    applyFilters({ query: null });
  }

  const emptyState =
    query ? (
      <EmptyState
        icon={Search}
        title="No matching articles"
        description={`No articles match “${query}” in this Browse context.`}
        action={{ label: "Clear search", href: browseHrefFor(activeView, { ...filters, query: null }) }}
      />
    ) :
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
    );

  return (
    <div>
      {/* Category tab bar — wraps onto multiple rows so every category stays
          visible without a horizontal scrollbar. */}
      <nav
        className="flex flex-wrap items-center gap-[var(--space-2)] mt-[var(--space-5)] mb-[var(--space-3)]"
        aria-label="Categories"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={tab.key === activeView ? "page" : undefined}
            className={cn(
              "inline-flex items-center shrink-0",
              "h-8 px-[var(--space-3)]",
              "rounded-[var(--radius-full)]",
              "text-[length:var(--text-sm)] font-medium",
              "no-underline",
              "transition-colors [transition-duration:var(--duration-fast)]",
              tab.key === activeView
                ? "bg-primary text-on-primary"
                : "bg-bg-subtle text-text-muted hover:text-text hover:bg-[color-mix(in_srgb,var(--text)_8%,transparent)]",
              focusRing,
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {/* Search + level filter row — one wrapping line: search box (reduced
          width) · Search · (Clear) · Level filter. */}
      <div className="flex flex-wrap items-end gap-x-[var(--space-4)] gap-y-[var(--space-3)] mb-[var(--space-5)]">
        <form
          className="flex flex-wrap items-end gap-[var(--space-2)]"
          role="search"
          aria-label="Search within Browse"
          onSubmit={handleSearchSubmit}
        >
          <div className="flex w-full flex-col gap-[var(--space-1)] sm:w-72">
            <Label htmlFor="browse-search">Search Browse</Label>
            <Input
              id="browse-search"
              value={searchDraft}
              inputSize="sm"
              type="search"
              placeholder="Search articles in this context…"
              onChange={(e) => setSearchDraft(e.target.value)}
            />
          </div>
          <Button
            type="submit"
            size="sm"
            loading={isPending}
            leadingIcon={<Search size={14} aria-hidden="true" />}
          >
            Search
          </Button>
          {query ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleSearchClear}
              leadingIcon={<X size={14} aria-hidden="true" />}
            >
              Clear
            </Button>
          ) : null}
        </form>

        <div className="flex items-center gap-[var(--space-2)]">
          <label
            htmlFor="browse-level-filter"
            className="text-text-muted text-[length:var(--type-ui)] whitespace-nowrap"
          >
            Level
          </label>
          <div className="w-36">
            <Select
              id="browse-level-filter"
              value={level ?? ""}
              onChange={(e) => applyFilters({ level: e.target.value || null })}
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

        <div className="flex items-center gap-[var(--space-2)]">
          <label
            htmlFor="browse-maturity-filter"
            className="text-text-muted text-[length:var(--type-ui)] whitespace-nowrap"
          >
            Suitable for
          </label>
          <div className="w-40">
            <Select
              id="browse-maturity-filter"
              value={maturity ?? ""}
              onChange={(e) => applyFilters({ maturity: e.target.value || null })}
              selectSize="sm"
            >
              <option value="">All audiences</option>
              {FILTERABLE_MATURITY_BANDS.map((band) => (
                <option key={band} value={band}>
                  {MATURITY_BAND_LABELS[band]}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-[var(--space-2)]">
          <label
            htmlFor="browse-skill-filter"
            className="text-text-muted text-[length:var(--type-ui)] whitespace-nowrap"
          >
            Reading skill
          </label>
          <div className="w-52">
            <Select
              id="browse-skill-filter"
              value={skill ?? ""}
              onChange={(e) => applyFilters({ skill: e.target.value || null })}
              selectSize="sm"
            >
              <option value="">All skills</option>
              {READING_SKILLS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      {/* Section heading */}
      <h2
        className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--type-section-title)] text-text mt-0 mb-[var(--space-3)]"
      >
        {heading}
      </h2>

      <ArticleListingGrid
        articles={articles}
        progress={progress}
        savedIds={savedIds}
        hasMore={hasMore}
        loading={loading}
        loadError={loadError}
        onLoadMore={() => void loadMore()}
        empty={emptyState}
      />
    </div>
  );
}
