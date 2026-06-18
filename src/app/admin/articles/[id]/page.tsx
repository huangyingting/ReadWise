import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { getAdminArticleDetail } from "@/lib/admin-articles";
import { readingMinutesFor } from "@/lib/articles";
import { sanitizeArticleHtml } from "@/lib/sanitize";
import AdminArticleActions from "@/components/AdminArticleActions";

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
    <section className="stack" style={{ marginTop: "1.5rem" }}>
      <Link href="/admin/articles" className="muted">
        ← Back to articles
      </Link>

      <h2 style={{ marginBottom: 0 }}>{article.title}</h2>
      <div className="article-meta muted">
        <span className="pill">{article.status}</span>
        {article.difficulty && <span className="pill">Level {article.difficulty}</span>}
        {article.category && <span className="pill">{article.category}</span>}
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

      <div className="card stack">
        <h3 style={{ margin: 0 }}>Derived content</h3>
        <div className="admin-stat-grid">
          {aiItems.map((item) => (
            <div key={item.label} className="card admin-stat">
              <div className="admin-stat-value">{item.value}</div>
              <div className="muted">{item.label}</div>
            </div>
          ))}
        </div>
        <AdminArticleActions articleId={article.id} redirectOnDelete="/admin/articles" />
      </div>

      <h3 style={{ marginBottom: 0 }}>Content</h3>
      <article
        className="article admin-article-preview"
        dangerouslySetInnerHTML={{ __html: sanitizeArticleHtml(article.content) }}
      />
    </section>
  );
}
