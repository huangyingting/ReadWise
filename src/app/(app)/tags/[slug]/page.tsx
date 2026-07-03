import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Tag } from "lucide-react";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { getTagBySlug, listArticlesByTag, toListingArticle } from "@/lib/article-library";
import { getProgressMap } from "@/lib/engagement";
import { ensureArticleDifficulties } from "@/lib/difficulty";
import { getBookmarkedArticleIds } from "@/lib/article-library";
import ArticleCardView from "@/components/ArticleCardView";
import ListingSync from "@/components/ListingSync";
import { EmptyState, PageHeader, PageShell } from "@/components/ui";

type TaggedArticle = Awaited<ReturnType<typeof listArticlesByTag>>[number];
type ProgressMap = Awaited<ReturnType<typeof getProgressMap>>;
type ProgressEntry = ProgressMap extends Map<string, infer Entry> ? Entry : never;
type BookmarkedIds = Awaited<ReturnType<typeof getBookmarkedArticleIds>>;

function articleCountLabel(count: number): string {
  return count === 1 ? "1 article" : `${count} articles`;
}

function tagDescription(tagName: string, count: number): string {
  return `${articleCountLabel(count)} tagged "${tagName}"`;
}

function cardProgress(progress: ProgressEntry | undefined) {
  return progress
    ? { percent: progress.percent, completed: progress.completed }
    : undefined;
}

function TaggedArticleGrid({
  articles,
  progressMap,
  bookmarkedIds,
}: {
  articles: TaggedArticle[];
  progressMap: ProgressMap;
  bookmarkedIds: BookmarkedIds;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[var(--space-4)] sm:gap-[var(--space-5)] lg:gap-[var(--space-6)] rw-fade-up">
      {articles.map((article) => (
        <ArticleCardView
          key={article.id}
          article={toListingArticle(article)}
          saved={bookmarkedIds.has(article.id)}
          progress={cardProgress(progressMap.get(article.id))}
        />
      ))}
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tag = await getTagBySlug(slug);
  return { title: tag ? `#${tag.name}` : "Tag" };
}

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
  const articleIds = articles.map((article) => article.id);
  const [progressMap, bookmarkedIds] = await Promise.all([
    getProgressMap(session.user.id, articleIds),
    getBookmarkedArticleIds(session.user.id, articleIds),
  ]);

  const count = articles.length;

  return (
    <PageShell variant="listing">
      <Link
        href="/tags"
        className="inline-flex items-center gap-1 text-[length:var(--text-sm)] text-text-muted hover:text-text mb-[var(--space-4)] transition-colors"
      >
        ← All tags
      </Link>

      <PageHeader
        title={`#${tag.name}`}
        description={tagDescription(tag.name, count)}
      />

      {articles.length === 0 ? (
        <EmptyState
          icon={Tag}
          title="No articles with this tag"
          description="Nothing carries this tag yet."
          action={{ label: "Browse all", href: "/browse" }}
        />
      ) : (
        <TaggedArticleGrid
          articles={articles}
          progressMap={progressMap}
          bookmarkedIds={bookmarkedIds}
        />
      )}

      <ListingSync articleIds={articleIds} />
    </PageShell>
  );
}
