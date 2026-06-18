import Link from "next/link";
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

  const progress = await getProgressSummaries(
    session.user.id,
    page.articles.map((a) => a.id),
  );

  const heading = isPicks
    ? "Picks for you"
    : activeCategory
      ? CATEGORIES.find((c) => c.slug === activeCategory)?.label ?? "Browse"
      : "All categories";

  return (
    <main className="container">
      <p style={{ marginBottom: "1rem" }}>
        <Link href="/dashboard">← Back to dashboard</Link>
      </p>

      <h1 style={{ marginBottom: "0.25rem" }}>Browse</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {isPicks
          ? "Articles picked to match your topics and English level."
          : "Browse cleaned news articles by category."}
      </p>

      <h2 style={{ marginTop: "1.5rem" }}>{heading}</h2>

      <CategoryBrowser
        key={activeView}
        activeView={activeView}
        initialArticles={page.articles.map(toListingArticle)}
        initialProgress={progress}
        initialHasMore={page.hasMore}
        initialOffset={page.articles.length}
      />
    </main>
  );
}
