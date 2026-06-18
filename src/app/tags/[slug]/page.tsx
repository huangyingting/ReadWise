import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { getTagBySlug, listArticlesByTag } from "@/lib/tags";
import { getProgressMap } from "@/lib/progress";
import { ensureArticleDifficulties } from "@/lib/difficulty";
import ArticleCard from "@/components/ArticleCard";
import ListingProgressSync from "@/components/ListingProgressSync";

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
  const progressMap = await getProgressMap(
    session.user.id,
    articles.map((a) => a.id),
  );

  return (
    <main className="container">
      <p style={{ marginBottom: "1rem" }}>
        <Link href="/dashboard">← Back to dashboard</Link>
      </p>

      <h1 style={{ marginBottom: "0.25rem" }}>#{tag.name}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {articles.length === 1
          ? "1 article"
          : `${articles.length} articles`}{" "}
        tagged “{tag.name}”
      </p>

      {articles.length === 0 ? (
        <p className="muted">No articles carry this tag yet.</p>
      ) : (
        <div className="article-grid">
          {articles.map((article) => {
            const progress = progressMap.get(article.id);
            return (
              <ArticleCard
                key={article.id}
                article={article}
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
    </main>
  );
}
