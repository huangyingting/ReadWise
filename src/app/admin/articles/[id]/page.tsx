import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { getAdminArticleDetail } from "@/lib/admin-articles";
import { statusBadgeVariant } from "@/lib/admin";
import { readingMinutesFor } from "@/lib/articles";
import { sanitizeArticleHtml } from "@/lib/sanitize";
import AdminArticleActions from "@/components/AdminArticleActions";
import { Card, CardMeta, CardTitle } from "@/components/ui/Card";
import { Badge, CefrBadge, CEFR_LEVELS, type CefrLevel } from "@/components/ui/Badge";

export default async function AdminArticleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAdmin(`/admin/articles/${id}`);

  const detail = await getAdminArticleDetail(id);
  if (!detail) {
    notFound();
  }

  const { article, counts } = detail;
  const minutes = readingMinutesFor(article);
  const aiItems: { label: string; value: number }[] = [
    { label: "Translations", value: counts.translations },
    { label: "Vocabulary", value: counts.vocabulary },
    { label: "Quiz questions", value: counts.quizQuestions },
    { label: "Tags", value: counts.tags },
    { label: "Narration", value: counts.speech },
    { label: "Reads tracked", value: counts.readingProgress },
  ];

  return (
    <section className="stack mt-[var(--space-6)]">
      <Link href="/admin/articles" className="muted">
        ← Back to articles
      </Link>

      <h1 className="m-0 text-[length:var(--text-3xl)] font-[family-name:var(--font-display)] font-bold text-text">
        {article.title}
      </h1>
      <div className="article-meta muted">
        <Badge variant={statusBadgeVariant(article.status)}>
          {article.status}
        </Badge>
        {article.difficulty &&
          (CEFR_LEVELS as readonly string[]).includes(article.difficulty) ? (
            <CefrBadge level={article.difficulty as CefrLevel} />
          ) : (
            article.difficulty && (
              <Badge variant="neutral">Level {article.difficulty}</Badge>
            )
          )}
        {article.category && (
          <Badge variant="neutral">{article.category}</Badge>
        )}
        {minutes != null && <span>{minutes} min read</span>}
        {article.author && <span>By {article.author}</span>}
        {article.source && <span>{article.source}</span>}
      </div>

      {article.sourceUrl && (
        <p className="muted" style={{ margin: 0 }}>
          Source:{" "}
          <a href={article.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">
            {article.sourceUrl}
          </a>
        </p>
      )}

      <Card>
        <div className="stack">
          <CardTitle level="h3">Derived content</CardTitle>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-[var(--space-4)]">
            {aiItems.map((item) => (
              <Card key={item.label} className="p-[var(--space-4)]">
                <div className="text-[length:var(--text-2xl)] font-bold font-[family-name:var(--font-display)] text-text">
                  {item.value}
                </div>
                <CardMeta>{item.label}</CardMeta>
              </Card>
            ))}
          </div>
          <AdminArticleActions articleId={article.id} redirectOnDelete="/admin/articles" />
        </div>
      </Card>

      <h3>Content</h3>
      <Card>
        <article
          className="article prose"
          dangerouslySetInnerHTML={{ __html: sanitizeArticleHtml(article.content) }}
        />
      </Card>
    </section>
  );
}
