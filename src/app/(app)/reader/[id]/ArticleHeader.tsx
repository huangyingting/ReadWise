/**
 * Reader article header (REF-029).
 *
 * Renders the title, byline/source, meta row (CEFR badge, reading-time badge,
 * completed badge, bookmark cluster, offline button), and tag chips for the
 * reader article header. Receives pre-computed display values from the page
 * loader so this component is a pure presentational server component.
 */
import Link from "next/link";
import { TagScope } from "@prisma/client";
import type { Article, ReadingProgress } from "@prisma/client";
import type { TagView } from "@/lib/article-library";
import { type CefrLevel, CefrBadge, Badge } from "@/components/ui/Badge";
import ReaderBookmarkCluster from "@/components/ReaderBookmarkCluster";
import OfflineDownloadButton from "@/components/OfflineDownloadButton";
import SetTodayArticleButton from "@/components/SetTodayArticleButton";

type Props = {
  article: Pick<Article, "id" | "title" | "author" | "source" | "sourceUrl">;
  difficultyLevel: CefrLevel | null;
  isValidCefrLevel: boolean;
  readingMinutes: number | null;
  progress: ReadingProgress | null;
  isBookmarked: boolean;
  tags: TagView[];
  /** Today Session v1.1 (#805): render the "Set as today's article" affordance. */
  setTodayEnabled?: boolean;
};

export default function ArticleHeader({
  article,
  difficultyLevel,
  isValidCefrLevel,
  readingMinutes,
  progress,
  isBookmarked,
  tags,
  setTodayEnabled = false,
}: Props) {
  return (
    <header className="reader-article-header">
      <h1 id="article-title" className="reader-article-title">
        {article.title}
      </h1>

      {/* Byline / source */}
      {article.author || article.source ? (
        <p className="reader-byline">
          {article.author ? article.author : null}
          {article.author && article.source ? " · " : null}
          {article.source && article.sourceUrl ? (
            <a href={article.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">
              {article.source}
            </a>
          ) : article.source ? (
            article.source
          ) : null}
        </p>
      ) : null}

      {/* Meta row: CEFR badge · reading time · completed · bookmark */}
      <div className="reader-meta">
        {isValidCefrLevel ? (
          <CefrBadge level={difficultyLevel as CefrLevel} title="AI-estimated reading level" />
        ) : difficultyLevel ? (
          <Badge variant="neutral" title="AI-estimated reading level">
            Level {difficultyLevel}
          </Badge>
        ) : null}

        {readingMinutes != null ? (
          <Badge variant="neutral">⏱ {readingMinutes} min read</Badge>
        ) : null}

        {progress?.completed ? <Badge variant="success">✓ Completed</Badge> : null}

        {/* M10 bookmark split-pill (segment A toggle + segment B list picker) */}
        <ReaderBookmarkCluster articleId={article.id} initialSaved={isBookmarked} />

        {/* #117 offline download button */}
        <OfflineDownloadButton articleId={article.id} />

        {/* Today Session v1.1 (#805) — set this readable article as today's primary. */}
        {setTodayEnabled ? (
          <SetTodayArticleButton
            articleId={article.id}
            articleTitle={article.title}
          />
        ) : null}
      </div>

      {/* Tags */}
      {tags.length > 0 ? (
        <div className="reader-tags" aria-label="Article tags">
          {tags.map((tag) =>
            tag.scope === TagScope.PUBLIC ? (
              <Link key={tag.id} href={`/tags/${tag.slug}`} className="tag-chip">
                #{tag.name}
              </Link>
            ) : (
              <span key={tag.id} className="tag-chip">
                #{tag.name}
              </span>
            ),
          )}
        </div>
      ) : null}
    </header>
  );
}
