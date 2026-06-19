import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { getArticleById, readingMinutesFor } from "@/lib/articles";
import { getProgress } from "@/lib/progress";
import { getOrCreateArticleDifficulty } from "@/lib/difficulty";
import { getOrCreateArticleTags, listRelatedArticles } from "@/lib/tags";
import { sanitizeArticleHtml } from "@/lib/sanitize";
import { getProgressMap } from "@/lib/progress";
import ReaderProgress from "@/components/ReaderProgress";
import ArticleCard from "@/components/ArticleCard";
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
  const difficulty = await getOrCreateArticleDifficulty(article.id);
  const difficultyLevel = difficulty?.level ?? article.difficulty;
  const tags = (await getOrCreateArticleTags(article.id))?.tags ?? [];
  const relatedArticles = await listRelatedArticles(article.id);
  const relatedProgress = await getProgressMap(
    session.user.id,
    relatedArticles.map((a) => a.id),
  );
  const readingMinutes = readingMinutesFor(article);
  const cleanBody = sanitizeArticleHtml(article.content);

  const meta = [article.author, article.source].filter(Boolean).join(" · ");

  return (
    <main className="container">
      <ReaderProgress
        articleId={article.id}
        initialPercent={progress?.percent ?? 0}
      />

      <article className="article">
        <header className="stack">
          <h1 style={{ marginBottom: 0 }}>{article.title}</h1>
          {meta ? <p className="muted" style={{ margin: 0 }}>{meta}</p> : null}
          <div className="article-meta muted">
            {readingMinutes != null ? (
              <span className="pill">{readingMinutes} min read</span>
            ) : null}
            {difficultyLevel ? (
              <span className="pill" title="Assessed English level">
                Level {difficultyLevel}
              </span>
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
          {tags.length > 0 ? (
            <div className="tag-list" aria-label="Article tags">
              {tags.map((tag) => (
                <Link key={tag.id} href={`/tags/${tag.slug}`} className="tag-chip">
                  #{tag.name}
                </Link>
              ))}
            </div>
          ) : null}
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

      {relatedArticles.length > 0 ? (
        <section className="related-articles" aria-label="Related articles">
          <h2 style={{ marginBottom: "0.75rem" }}>Related articles</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Other articles that share tags with this one.
          </p>
          <div className="article-grid">
            {relatedArticles.map((related) => {
              const progress = relatedProgress.get(related.id);
              return (
                <ArticleCard
                  key={related.id}
                  article={related}
                  progress={
                    progress
                      ? { percent: progress.percent, completed: progress.completed }
                      : undefined
                  }
                />
              );
            })}
          </div>
        </section>
      ) : null}
    </main>
  );
}
