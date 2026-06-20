import { requireSession } from "@/lib/session";
import {
  BROWSE_PAGE_SIZE,
  listCategoryPage,
  listPicksPage,
  toListingArticle,
} from "@/lib/articles";
import { getProgressSummaries } from "@/lib/progress";
import { getProfile, parseTopics } from "@/lib/profile";
import { isValidCategorySlug, CATEGORIES } from "@/lib/categories";
import { isDifficultyLevel } from "@/lib/difficulty";
import { getBookmarkedArticleIds } from "@/lib/bookmarks";
import CategoryBrowser from "@/components/CategoryBrowser";

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; category?: string }>;
}) {
  const session = await requireSession("/browse");
  const { view, category } = await searchParams;

  const isPicks = view === "picks";
  const activeCategory =
    !isPicks && category && category !== "all" && isValidCategorySlug(category)
      ? category
      : null;
  const activeView = isPicks ? "picks" : (activeCategory ?? "all");

  let page;
  if (isPicks) {
    const profile = await getProfile(session.user.id);
    const level = isDifficultyLevel(profile?.englishLevel) ? profile.englishLevel : null;
    const topics = parseTopics(profile?.topics);
    page = await listPicksPage(level, topics, { limit: BROWSE_PAGE_SIZE });
  } else {
    page = await listCategoryPage(activeCategory, { limit: BROWSE_PAGE_SIZE });
  }

  const articleIds = page.articles.map((a) => a.id);
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
    <main className="listing-container">
      <h1
        className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-3xl)] leading-tight text-text"
        style={{ marginBottom: "0.25rem" }}
      >
        Browse
      </h1>
      <p
        className="text-text-muted text-[length:var(--text-base)]"
        style={{ marginTop: 0 }}
      >
        {isPicks
          ? "Articles picked to match your topics and English level."
          : "Browse cleaned news articles by category."}
      </p>

      <CategoryBrowser
        key={activeView}
        activeView={activeView}
        initialArticles={page.articles.map(toListingArticle)}
        initialProgress={progress}
        initialHasMore={page.hasMore}
        initialOffset={page.articles.length}
        heading={heading}
        initialSavedIds={[...bookmarkedIds]}
      />
    </main>
  );
}
