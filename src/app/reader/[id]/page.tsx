import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { getArticleById, readingMinutesFor } from "@/lib/articles";
import { getProgress } from "@/lib/progress";
import { sanitizeArticleHtml } from "@/lib/sanitize";
import ReaderProgress from "@/components/ReaderProgress";
import ArticleTranslation from "@/components/ArticleTranslation";
import ArticleVocabulary from "@/components/ArticleVocabulary";
import ArticleQuiz from "@/components/ArticleQuiz";
import ArticleSpeech from "@/components/ArticleSpeech";
import WordLookup from "@/components/WordLookup";
import { SUPPORTED_LANGUAGES } from "@/lib/translation";

export default async function ReaderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession(`/reader/${id}`);

  const article = await getArticleById(id);
  if (!article) {
    notFound();
  }

  const progress = await getProgress(session.user.id, article.id);
  const readingMinutes = readingMinutesFor(article);
  const cleanBody = sanitizeArticleHtml(article.content);

  const meta = [article.author, article.source].filter(Boolean).join(" · ");

  return (
    <main className="container">
      <ReaderProgress
        articleId={article.id}
        initialPercent={progress?.percent ?? 0}
      />
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
            {progress?.completed ? (
              <span className="pill pill-done">✓ Completed</span>
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

        <p className="muted word-lookup-hint">
          Tip: click or select any word to look up its meaning.
        </p>

        <WordLookup html={cleanBody} />

        <ArticleSpeech articleId={article.id} />

        <ArticleVocabulary articleId={article.id} />

        <ArticleQuiz articleId={article.id} />

        <ArticleTranslation
          articleId={article.id}
          languages={SUPPORTED_LANGUAGES}
        />
      </article>
    </main>
  );
}
