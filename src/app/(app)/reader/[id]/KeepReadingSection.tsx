/**
 * "Keep reading" section rendered after the article body (REF-029, #110).
 *
 * Shows up to three related articles from tag-based related articles, falling
 * back to same-category articles when no tag matches are found. Renders
 * nothing when there are no articles to show.
 */
import type { Article, ReadingProgress } from "@prisma/client";
import ArticleCard from "@/components/ArticleCard";
import ListingProgressSync from "@/components/ListingProgressSync";
import ListingBookmarkSync from "@/components/ListingBookmarkSync";

type Props = {
  articles: Article[];
  relatedProgress: Map<string, ReadingProgress>;
  isCompleted: boolean;
  /** True when articles came from tag matches; false when from category fallback. */
  hadRelated: boolean;
};

export default function KeepReadingSection({
  articles,
  relatedProgress,
  isCompleted,
  hadRelated,
}: Props) {
  if (articles.length === 0) return null;

  return (
    <section className="reader-related" aria-label="Keep reading">
      {isCompleted ? (
        <div className="reader-completion-banner" role="status">
          <span aria-hidden="true">✓</span>
          <span>Article completed! Here&rsquo;s what to read next.</span>
        </div>
      ) : null}
      <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text mb-[var(--space-4)] mt-0">
        Keep reading
      </h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {hadRelated
          ? "Other articles that share tags with this one."
          : "More articles from the same category."}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[var(--space-4)] sm:gap-[var(--space-5)] lg:gap-[var(--space-6)]">
        {articles.map((related) => {
          const rel = relatedProgress.get(related.id);
          return (
            <ArticleCard
              key={related.id}
              article={related}
              progress={rel ? { percent: rel.percent, completed: rel.completed } : undefined}
            />
          );
        })}
      </div>
      <ListingProgressSync articleIds={articles.map((a) => a.id)} />
      <ListingBookmarkSync articleIds={articles.map((a) => a.id)} />
    </section>
  );
}
