import { Check, ChevronRight } from "lucide-react";
import type { ListingArticle } from "@/lib/articles";
import type { ProgressSummary } from "@/lib/progress";
import { Sparkles } from "lucide-react";
import { CefrBadge, type CefrLevel, CEFR_LEVELS } from "@/components/ui/Badge";
import { humanizeCategorySlug } from "@/lib/categories";
import { cn, focusRing } from "@/lib/cn";
import { Tooltip } from "@/components/ui/Tooltip";
import CardBookmarkButton from "@/components/CardBookmarkButton";
import ArticleHero from "@/components/ArticleHero";
import ReferrerLink from "@/components/ReferrerLink";

export type ArticleCardProgress = ProgressSummary;

/** Short descriptions for each CEFR level shown as a tooltip on the difficulty badge. */
const CEFR_DESCRIPTIONS: Record<string, string> = {
  A1: "A1 · Beginner — estimated reading level",
  A2: "A2 · Elementary — estimated reading level",
  B1: "B1 · Intermediate — estimated reading level",
  B2: "B2 · Upper-Intermediate — estimated reading level",
  C1: "C1 · Advanced — estimated reading level",
  C2: "C2 · Proficient — estimated reading level",
};

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
  reason,
}: {
  article: ListingArticle;
  progress?: ArticleCardProgress;
  variant?: "grid" | "rail";
  /** SSR initial saved state for the bookmark overlay. */
  saved?: boolean;
  /** When provided on the /lists page: remove from this list instead of toggling default. */
  removeListId?: string;
  removeListName?: string;
  /** Optional "why" chip text (M15 For You feed). Renders a quiet metadata chip
   *  between the byline and the progress footer. Does NOT touch any progress/bookmark DOM hooks. */
  reason?: string;
}) {
  const percent = progress?.percent ?? 0;
  const completed = progress?.completed ?? false;
  const notStarted = percent === 0 && !completed;

  const byline = [article.author, article.source].filter(Boolean).join(" · ");

  const categoryLabel = article.category
    ? humanizeCategorySlug(article.category)
    : null;

  const level =
    article.difficulty &&
    (CEFR_LEVELS as readonly string[]).includes(article.difficulty)
      ? (article.difficulty as CefrLevel)
      : null;

  const readingTimeLabel =
    article.readingMinutes != null ? `${article.readingMinutes} min read` : null;

  /** True when the article was published within the last 24 hours. */
  const isNew = (() => {
    if (!article.publishedAt) return false;
    const published =
      typeof article.publishedAt === "string"
        ? new Date(article.publishedAt)
        : article.publishedAt;
    return Date.now() - published.getTime() < 24 * 60 * 60 * 1000;
  })();

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
      <ReferrerLink
        href={`/reader/${article.id}`}
        data-article-id={article.id}
        className={cn(
          "group flex flex-col h-full no-underline",
          "bg-surface border border-border rounded-[var(--radius-lg)] shadow-[var(--shadow-sm)]",
          "text-text gap-[var(--space-3)]",
          variant === "rail"
            ? "p-[var(--space-4)]"
            : "p-[var(--space-4)] sm:p-[var(--space-5)]",
          "transition-[box-shadow,border-color,transform,color]",
          "[transition-duration:var(--duration-base)] [transition-timing-function:var(--ease-standard)]",
          "hover:shadow-[var(--shadow-md)] hover:border-border-strong hover:-translate-y-0.5",
          "active:translate-y-px active:shadow-[var(--shadow-sm)]",
          "motion-reduce:transform-none",
          focusRing,
        )}
      >
      {/* ⓪ Optional 16:9 thumbnail — collapses gracefully when absent/broken */}
      {article.heroImage ? (
        <ArticleHero
          src={article.heroImage}
          alt={article.title}
          variant="thumb"
        />
      ) : null}

      {/* ① Top meta row — pr-9 reserves space for the absolute bookmark button */}
      <div className="flex items-center justify-between gap-[var(--space-2)] pr-9">
        <div className="flex items-center gap-[var(--space-2)] min-w-0">
          {level ? (
            <Tooltip content={CEFR_DESCRIPTIONS[level] ?? level} side="top">
              <span>
                <CefrBadge level={level} />
              </span>
            </Tooltip>
          ) : null}
          {isNew && (
            <span
              aria-label="New"
              className={cn(
                "inline-flex items-center rounded-[var(--radius-full)]",
                "px-[var(--space-2)] py-px",
                "text-[length:var(--text-xs)] font-semibold",
                "bg-green-100 text-green-700 border border-green-200",
                "dark:bg-green-900/30 dark:text-green-400 dark:border-green-800",
              )}
            >
              New
            </span>
          )}
          {/* Meta: category (can truncate) + "N min read" (shrink-0, never cut) */}
          {(categoryLabel || readingTimeLabel) ? (
            <span className="flex items-center gap-[var(--space-1)] min-w-0 text-text-subtle text-[length:var(--text-xs)]">
              {categoryLabel ? (
                <span className="truncate">{categoryLabel}</span>
              ) : null}
              {categoryLabel && readingTimeLabel ? (
                <span className="shrink-0">·</span>
              ) : null}
              {readingTimeLabel ? (
                <span className="shrink-0">{readingTimeLabel}</span>
              ) : null}
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

      {/* ③b "Why" chip — M15 For You feed only; absent on all other listings (no layout shift) */}
      {reason ? (
        <span
          className="rw-why-chip"
          title={reason}
          aria-label={`Recommendation reason: ${reason}`}
        >
          <Sparkles size={12} aria-hidden className="shrink-0 text-text-subtle" />
          {reason}
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
        {notStarted ? (
          <span className="js-progress-label text-[length:var(--text-xs)] text-primary-text flex items-center gap-[var(--space-1)]">
            Start reading <ChevronRight size={12} aria-hidden />
          </span>
        ) : (
          <span className="js-progress-label text-[length:var(--text-xs)] text-text-subtle">
            {completed ? "Read" : `${percent}% read`}
          </span>
        )}
      </div>
    </ReferrerLink>

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
