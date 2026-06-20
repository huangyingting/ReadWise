import { notFound } from "next/navigation";
import { Tag } from "lucide-react";
import { requireSession } from "@/lib/session";
import { getTagBySlug, listArticlesByTag } from "@/lib/tags";
import { getProgressMap } from "@/lib/progress";
import { ensureArticleDifficulties } from "@/lib/difficulty";
import { getBookmarkedArticleIds } from "@/lib/bookmarks";
import ArticleCard from "@/components/ArticleCard";
import ListingProgressSync from "@/components/ListingProgressSync";
import ListingBookmarkSync from "@/components/ListingBookmarkSync";
import EmptyState from "@/components/EmptyState";

export default async function TagPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await requireSession(`/tags/${slug}`);

  const tag = await getTagBySlug(slug);
  if (!tag) {
    notFound();
  }

  const articles = await listArticlesByTag(slug);
  await ensureArticleDifficulties(articles);
  const articleIds = articles.map((a) => a.id);
  const [progressMap, bookmarkedIds] = await Promise.all([
    getProgressMap(session.user.id, articleIds),
    getBookmarkedArticleIds(session.user.id, articleIds),
  ]);

  const count = articles.length;

  return (
    <div className="listing-container">
      <h1
        className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-3xl)] leading-tight text-text"
        style={{ marginBottom: "0.25rem" }}
      >
        #{tag.name}
      </h1>
      <p
        className="text-text-muted text-[length:var(--text-base)]"
        style={{ marginTop: 0 }}
      >
        {count === 1 ? "1 article" : `${count} articles`} tagged &ldquo;
        {tag.name}&rdquo;
      </p>

      {articles.length === 0 ? (
        <EmptyState
          icon={Tag}
          title="No articles with this tag"
          description="Nothing carries this tag yet."
          action={{ label: "Browse all", href: "/browse" }}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[var(--space-4)] sm:gap-[var(--space-5)] lg:gap-[var(--space-6)] rw-fade-up">
          {articles.map((article) => {
            const progress = progressMap.get(article.id);
            return (
              <ArticleCard
                key={article.id}
                article={article}
                saved={bookmarkedIds.has(article.id)}
                progress={
                  progress
                    ? { percent: progress.percent, completed: progress.completed }
                    : undefined
                }
              />
            );
          })}
        </div>
      )}

      <ListingProgressSync articleIds={articles.map((a) => a.id)} />
      <ListingBookmarkSync articleIds={articles.map((a) => a.id)} />
    </div>
  );
}
