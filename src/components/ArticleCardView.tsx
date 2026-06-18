import Link from "next/link";
import type { ListingArticle } from "@/lib/articles";

export type ArticleCardProgress = {
  percent: number;
  completed: boolean;
};

/**
 * Presentational article card. Takes a plain, serializable {@link ListingArticle}
 * so it can be rendered both by server listings and by client-side incremental
 * loaders. Keeps the `js-progress-*` hooks + `data-article-id` that
 * `ListingProgressSync` relies on.
 */
export default function ArticleCardView({
  article,
  progress,
}: {
  article: ListingArticle;
  progress?: ArticleCardProgress;
}) {
  const meta = [article.author, article.source].filter(Boolean).join(" · ");
  const percent = progress?.percent ?? 0;
  const completed = progress?.completed ?? false;

  return (
    <Link href={`/reader/${article.id}`} className="article-card" data-article-id={article.id}>
      <div className="stack">
        <strong>{article.title}</strong>
        {meta ? (
          <span className="muted" style={{ fontSize: "0.85rem" }}>
            {meta}
          </span>
        ) : null}
        <div className="article-meta muted">
          {article.readingMinutes != null ? (
            <span className="pill">{article.readingMinutes} min read</span>
          ) : null}
          {article.difficulty ? (
            <span className="pill">Level {article.difficulty}</span>
          ) : null}
          <span
            className="pill pill-done js-progress-done"
            style={completed ? undefined : { display: "none" }}
          >
            ✓ Completed
          </span>
        </div>
        <div
          className="reading-progress reading-progress--inline js-progress-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="Reading progress"
        >
          <div
            className="reading-progress-bar"
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="muted js-progress-label" style={{ fontSize: "0.8rem" }}>
          {completed ? "Read" : percent > 0 ? `${percent}% read` : "Not started"}
        </span>
      </div>
    </Link>
  );
}
