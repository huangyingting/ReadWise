import { requireSession } from "@/lib/session";
import {
  BROWSE_PAGE_SIZE,
  listCategoryPage,
  toListingArticle,
  type ListingArticle,
} from "@/lib/articles";
import { listScoredPicksPage } from "@/lib/recommendations";
import { getProgressSummaries } from "@/lib/progress";
import { getProfile, parseTopics, ENGLISH_LEVELS } from "@/lib/profile";
import { isValidCategorySlug, CATEGORIES } from "@/lib/categories";
import { isDifficultyLevel } from "@/lib/difficulty";
import { getBookmarkedArticleIds } from "@/lib/bookmarks";
import CategoryBrowser from "@/components/CategoryBrowser";
import { PageShell } from "@/components/shell/PageShell";
import { PageHeader } from "@/components/shell/PageHeader";

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; category?: string; level?: string }>;
}) {
  const session = await requireSession("/browse");
  const { view, category, level: levelParam } = await searchParams;

  const isPicks = view === "picks";
  const activeCategory =
    !isPicks && category && category !== "all" && isValidCategorySlug(category)
      ? category
      : null;
  const activeView = isPicks ? "picks" : (activeCategory ?? "all");

  // URL-level filter — validated against ENGLISH_LEVELS (same set as CEFR levels)
  const urlLevel =
    levelParam && (ENGLISH_LEVELS as readonly string[]).includes(levelParam)
      ? (levelParam as (typeof ENGLISH_LEVELS)[number])
      : null;

  let listingArticles: ListingArticle[];
  let hasMore: boolean;
  if (isPicks) {
    const profile = await getProfile(session.user.id);
    // URL level overrides profile level when specified.
    const profileLevel = isDifficultyLevel(profile?.englishLevel) ? profile.englishLevel : null;
    const maxLevel = urlLevel ?? profileLevel;
    const topics = parseTopics(profile?.topics);
    const picks = await listScoredPicksPage(session.user.id, {
      maxLevel,
      topics,
      limit: BROWSE_PAGE_SIZE,
    });
    listingArticles = picks.articles;
    hasMore = picks.hasMore;
  } else {
    const page = await listCategoryPage(activeCategory, {
      limit: BROWSE_PAGE_SIZE,
      maxLevel: urlLevel,
    });
    listingArticles = page.articles.map(toListingArticle);
    hasMore = page.hasMore;
  }

  const articleIds = listingArticles.map((a) => a.id);
  const [progress, bookmarkedIds] = await Promise.all([
    getProgressSummaries(session.user.id, articleIds),
    getBookmarkedArticleIds(session.user.id, articleIds),
  ]);

  const heading = isPicks
    ? "Picks for you"
    : activeCategory
      ? CATEGORIES.find((c) => c.slug === activeCategory)?.label ?? "Browse"
      : "All categories";

  return (
    <PageShell variant="listing">
      <PageHeader
        title="Browse"
        description={
          isPicks
            ? "Articles picked to match your topics and English level."
            : "Browse cleaned news articles by category."
        }
      />

      <CategoryBrowser
        key={`${activeView}:${urlLevel ?? ""}`}
        activeView={activeView}
        initialArticles={listingArticles}
        initialProgress={progress}
        initialHasMore={hasMore}
        initialOffset={listingArticles.length}
        heading={heading}
        initialSavedIds={[...bookmarkedIds]}
        initialLevel={urlLevel}
      />
    </PageShell>
  );
}
