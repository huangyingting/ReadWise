import { requireSession } from "@/lib/session";
import {
  BROWSE_PAGE_SIZE,
  listCategoryPage,
  toListingArticle,
  type ListingArticle,
} from "@/lib/article-library";
import { listScoredPicksPage } from "@/lib/recommendations";
import { getProgressSummaries } from "@/lib/engagement";
import { ENGLISH_LEVELS } from "@/lib/option-registries";
import { getProfile } from "@/features/profile-preferences/repository";
import { parseTopics } from "@/features/profile-preferences/schema";
import { isValidCategorySlug, CATEGORIES } from "@/lib/categories";
import { isDifficultyLevel } from "@/lib/leveling/cefr-primitives";
import { getBookmarkedArticleIds } from "@/lib/article-library";
import CategoryBrowser from "@/components/CategoryBrowser";
import { PageHeader, PageShell } from "@/components/ui";

type BrowseSearchParams = {
  view?: string;
  category?: string;
  level?: string;
};
type EnglishLevel = (typeof ENGLISH_LEVELS)[number];
type BrowseArticlePage = {
  listingArticles: ListingArticle[];
  hasMore: boolean;
};

function getActiveCategory(isPicks: boolean, category?: string): string | null {
  if (isPicks || !category || category === "all") {
    return null;
  }

  return isValidCategorySlug(category) ? category : null;
}

function getUrlLevel(levelParam?: string): EnglishLevel | null {
  return levelParam && (ENGLISH_LEVELS as readonly string[]).includes(levelParam)
    ? (levelParam as EnglishLevel)
    : null;
}

async function loadBrowseArticles({
  activeCategory,
  isPicks,
  urlLevel,
  userId,
}: {
  activeCategory: string | null;
  isPicks: boolean;
  urlLevel: EnglishLevel | null;
  userId: string;
}): Promise<BrowseArticlePage> {
  if (isPicks) {
    const profile = await getProfile(userId);
    // URL level overrides profile level when specified.
    const profileLevel = isDifficultyLevel(profile?.englishLevel)
      ? profile.englishLevel
      : null;
    const maxLevel = urlLevel ?? profileLevel;
    const topics = parseTopics(profile?.topics);
    const picks = await listScoredPicksPage(userId, {
      maxLevel,
      topics,
      limit: BROWSE_PAGE_SIZE,
    });
    return {
      listingArticles: picks.articles,
      hasMore: picks.hasMore,
    };
  }

  const page = await listCategoryPage(activeCategory, {
    limit: BROWSE_PAGE_SIZE,
    maxLevel: urlLevel,
  });
  return {
    listingArticles: page.articles.map(toListingArticle),
    hasMore: page.hasMore,
  };
}

function getBrowseHeading(isPicks: boolean, activeCategory: string | null) {
  if (isPicks) {
    return "Picks for you";
  }

  if (activeCategory) {
    return CATEGORIES.find((c) => c.slug === activeCategory)?.label ?? "Browse";
  }

  return "All categories";
}

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<BrowseSearchParams>;
}) {
  const session = await requireSession("/browse");
  const { view, category, level: levelParam } = await searchParams;

  const isPicks = view === "picks";
  const activeCategory = getActiveCategory(isPicks, category);
  const activeView = isPicks ? "picks" : (activeCategory ?? "all");

  // URL-level filter — validated against ENGLISH_LEVELS (same set as CEFR levels)
  const urlLevel = getUrlLevel(levelParam);

  const { listingArticles, hasMore } = await loadBrowseArticles({
    activeCategory,
    isPicks,
    urlLevel,
    userId: session.user.id,
  });

  const articleIds = listingArticles.map((a) => a.id);
  const [progress, bookmarkedIds] = await Promise.all([
    getProgressSummaries(session.user.id, articleIds),
    getBookmarkedArticleIds(session.user.id, articleIds),
  ]);

  const heading = getBrowseHeading(isPicks, activeCategory);

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
