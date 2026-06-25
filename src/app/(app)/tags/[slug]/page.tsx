import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Tag } from "lucide-react";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { getTagBySlug, listArticlesByTag } from "@/lib/tags";
import { getProgressMap } from "@/lib/progress";
import { ensureArticleDifficulties } from "@/lib/difficulty";
import { getBookmarkedArticleIds } from "@/lib/bookmarks";
import ArticleCard from "@/components/ArticleCard";
import ListingSync from "@/components/ListingSync";
import EmptyState from "@/components/EmptyState";
import { PageShell } from "@/components/shell/PageShell";
import { PageHeader } from "@/components/shell/PageHeader";

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
  const articleIds = articles.map((a) => a.id);
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
        description={`${count === 1 ? "1 article" : `${count} articles`} tagged "${tag.name}"`}
      />

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

      <ListingSync articleIds={articles.map((a) => a.id)} />
    </PageShell>
  );
}
