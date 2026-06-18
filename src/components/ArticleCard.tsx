import Link from "next/link";
import type { Article } from "@prisma/client";
import { readingMinutesFor } from "@/lib/articles";

export type ArticleCardProgress = {
  percent: number;
  completed: boolean;
};

export default function ArticleCard({
  article,
  progress,
}: {
  article: Article;
  progress?: ArticleCardProgress;
}) {
  const readingMinutes = readingMinutesFor(article);
  const meta = [article.author, article.source].filter(Boolean).join(" · ");
  const percent = progress?.percent ?? 0;
  const completed = progress?.completed ?? false;

  return (
    <Link href={`/reader/${article.id}`} className="article-card">
      <div className="stack">
        <strong>{article.title}</strong>
        {meta ? (
          <span className="muted" style={{ fontSize: "0.85rem" }}>
            {meta}
          </span>
        ) : null}
        <div className="article-meta muted">
          {readingMinutes != null ? (
            <span className="pill">{readingMinutes} min read</span>
          ) : null}
          {article.difficulty ? (
            <span className="pill">Level {article.difficulty}</span>
          ) : null}
          {completed ? <span className="pill pill-done">✓ Completed</span> : null}
        </div>
        <div
          className="reading-progress reading-progress--inline"
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
        <span className="muted" style={{ fontSize: "0.8rem" }}>
          {completed ? "Read" : percent > 0 ? `${percent}% read` : "Not started"}
        </span>
      </div>
    </Link>
  );
}
