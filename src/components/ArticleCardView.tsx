import Link from "next/link";
import { Check } from "lucide-react";
import type { ListingArticle } from "@/lib/articles";
import type { ProgressSummary } from "@/lib/progress";
import { CefrBadge, type CefrLevel, CEFR_LEVELS } from "@/components/ui/Badge";
import { CATEGORIES } from "@/lib/categories";
import { cn, focusRing } from "@/lib/cn";
import CardBookmarkButton from "@/components/CardBookmarkButton";

export type ArticleCardProgress = ProgressSummary;

/**
 * Presentational article card — M4 redesign.
 *
 * Supports `variant="grid"` (default, fills grid track) and `variant="rail"`
 * (fixed-width for the horizontal continue-reading rail).
 *
 * ⚠️  ListingProgressSync DOM contract — preserved verbatim (§1.2):
 *   data-article-id     on the root <Link>       ← UNCHANGED
 *   .js-progress-bar    on the track wrapper (role="progressbar" + aria-value*)
 *   .reading-progress-bar  on the fill inside .js-progress-bar
 *   .js-progress-label  on the status text
 *   .js-progress-done   on the done chip — default-hidden via inline style
 *
 * M10 bookmark overlay (§1.2 sibling-overlay constraint):
 *   The wrapper div + sibling <CardBookmarkButton> are added WITHOUT touching
 *   any of the above hooks. The wrapper div also carries data-article-id so
 *   ListingBookmarkSync can resolve wrapper → .js-bookmark.
 *   The <Link> keeps its data-article-id verbatim (ListingProgressSync still
 *   resolves [data-article-id] → .js-progress-bar correctly from the wrapper).
 */
export default function ArticleCardView({
  article,
  progress,
  variant = "grid",
  saved,
  removeListId,
  removeListName,
}: {
  article: ListingArticle;
  progress?: ArticleCardProgress;
  variant?: "grid" | "rail";
  /** SSR initial saved state for the bookmark overlay. */
  saved?: boolean;
  /** When provided on the /lists page: remove from this list instead of toggling default. */
  removeListId?: string;
  removeListName?: string;
}) {
  const percent = progress?.percent ?? 0;
  const completed = progress?.completed ?? false;

  const byline = [article.author, article.source].filter(Boolean).join(" · ");

  const categoryLabel = article.category
    ? (CATEGORIES.find((c) => c.slug === article.category)?.label ??
      article.category)
    : null;

  const level =
    article.difficulty &&
    (CEFR_LEVELS as readonly string[]).includes(article.difficulty)
      ? (article.difficulty as CefrLevel)
      : null;

  const metaParts = [
    categoryLabel,
    article.readingMinutes != null
      ? `${article.readingMinutes} min read`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    /*
     * M10 sibling-overlay wrapper (§1.2): position context for the bookmark
     * button. The wrapper carries data-article-id so ListingBookmarkSync can
     * resolve wrapper → .js-bookmark. The <Link> ALSO keeps its own
     * data-article-id so ListingProgressSync (which queries [data-article-id]
     * → .js-progress-bar as descendants) is unaffected.
     */
    <div
      className={cn(
        "relative group/card",
        variant === "rail" ? "w-72 md:w-80 shrink-0 snap-start" : "h-full",
      )}
      data-card-wrapper
      data-article-id={article.id}
    >
      <Link
        href={`/reader/${article.id}`}
        data-article-id={article.id}
        className={cn(
          "group flex flex-col h-full no-underline",
          "bg-surface border border-border rounded-[var(--radius-lg)] shadow-[var(--shadow-sm)]",
          "text-text gap-[var(--space-3)]",
          variant === "rail"
            ? "p-[var(--space-5)]"
            : "p-[var(--space-5)] sm:p-[var(--space-6)]",
          "transition-[box-shadow,border-color,transform,color]",
          "[transition-duration:var(--duration-base)] [transition-timing-function:var(--ease-standard)]",
          "hover:shadow-[var(--shadow-md)] hover:border-border-strong hover:-translate-y-0.5",
          "active:translate-y-px active:shadow-[var(--shadow-sm)]",
          "motion-reduce:transform-none",
          focusRing,
        )}
      >
      {/* ① Top meta row */}
      <div className="flex items-center justify-between gap-[var(--space-2)]">
        <div className="flex items-center gap-[var(--space-2)] min-w-0">
          {level ? <CefrBadge level={level} /> : null}
          {metaParts ? (
            <span className="text-text-subtle text-[length:var(--text-xs)] truncate">
              {metaParts}
            </span>
          ) : null}
        </div>
        {/* ⑥ Done-check chip (§1.5) — default-hidden, toggled by ListingProgressSync */}
        <span
          className={cn(
            "js-progress-done shrink-0",
            "inline-flex items-center gap-[var(--space-1)]",
            "rounded-[var(--radius-full)]",
            "px-[var(--space-2)] py-[var(--space-1)]",
            "text-[length:var(--text-xs)] font-semibold",
            "bg-[color-mix(in_srgb,var(--bg-accent)_16%,transparent)]",
            "text-[var(--text-accent)]",
            "border border-[color-mix(in_srgb,var(--bg-accent)_30%,transparent)]",
          )}
          style={completed ? undefined : { display: "none" }}
        >
          <Check size={14} aria-hidden />
          Read
        </span>
      </div>

      {/* ② Title — 2-line clamp; indigo on hover/focus via group */}
      <strong
        className={cn(
          "font-[family-name:var(--font-display)] font-semibold",
          "text-[length:var(--text-lg)] leading-[var(--leading-snug)]",
          "text-text line-clamp-2 min-h-[2.4em]",
          "transition-colors [transition-duration:var(--duration-base)]",
          "group-hover:text-primary-text group-focus-visible:text-primary-text",
        )}
      >
        {article.title}
      </strong>

      {/* ③ Byline/source — omit when empty */}
      {byline ? (
        <span className="text-[length:var(--text-sm)] text-text-subtle truncate">
          {byline}
        </span>
      ) : null}

      {/* ④⑤ Progress footer — mt-auto pins to bottom regardless of title length */}
      <div className="mt-auto flex flex-col gap-[var(--space-1)]">
        <div
          className="js-progress-bar w-full h-1.5 rounded-[var(--radius-full)] bg-bg-subtle overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="Reading progress"
        >
          <div
            className="reading-progress-bar h-full rounded-[var(--radius-full)] bg-[var(--bg-accent)] transition-[width] [transition-duration:var(--duration-base)]"
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="js-progress-label text-[length:var(--text-xs)] text-text-subtle">
          {completed ? "Read" : percent > 0 ? `${percent}% read` : "Not started"}
        </span>
      </div>
    </Link>

    {/*
     * M10 bookmark button — sibling overlay, NOT nested inside <Link>.
     * Carries .js-bookmark for ListingBookmarkSync; data-saved attribute
     * drives CSS state (Tailwind data-[saved=true]: variants).
     */}
    <CardBookmarkButton
      articleId={article.id}
      articleTitle={article.title}
      initialSaved={saved ?? false}
      removeListId={removeListId}
      removeListName={removeListName}
    />
  </div>
  );
}
