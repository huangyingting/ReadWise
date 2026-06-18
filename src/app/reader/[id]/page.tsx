import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { getArticleById, readingMinutesFor } from "@/lib/articles";
import { sanitizeArticleHtml } from "@/lib/sanitize";

export default async function ReaderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireSession(`/reader/${id}`);

  const article = await getArticleById(id);
  if (!article) {
    notFound();
  }

  const readingMinutes = readingMinutesFor(article);
  const cleanBody = sanitizeArticleHtml(article.content);

  const meta = [article.author, article.source].filter(Boolean).join(" · ");

  return (
    <main className="container">
      <p style={{ marginBottom: "1rem" }}>
        <Link href="/dashboard">← Back to dashboard</Link>
      </p>

      <article className="article">
        <header className="stack">
          <h1 style={{ marginBottom: 0 }}>{article.title}</h1>
          {meta ? <p className="muted" style={{ margin: 0 }}>{meta}</p> : null}
          <div className="article-meta muted">
            {readingMinutes != null ? (
              <span className="pill">{readingMinutes} min read</span>
            ) : null}
            {article.difficulty ? (
              <span className="pill">Level {article.difficulty}</span>
            ) : null}
            {article.sourceUrl ? (
              <a href={article.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">
                Original source
              </a>
            ) : null}
          </div>
        </header>

        {article.heroImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="article-hero"
            src={article.heroImage}
            alt={article.title}
          />
        ) : null}

        <div
          className="prose"
          dangerouslySetInnerHTML={{ __html: cleanBody }}
        />
      </article>
    </main>
  );
}
