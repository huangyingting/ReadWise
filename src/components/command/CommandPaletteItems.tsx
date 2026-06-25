"use client";

/**
 * Render sub-components for the command palette results list.
 *
 * Keeping these in a dedicated module lets CommandPalette.tsx stay focused on
 * composition while making the individual row shapes independently reviewable.
 */

import { Skeleton } from "@/components/ui/Skeleton";
import {
  CefrBadge,
  CEFR_LEVELS,
  type CefrLevel,
  CategoryBadge,
} from "@/components/ui/Badge";
import { CATEGORIES } from "@/lib/categories";
import { cn } from "@/lib/cn";
import type { ListingArticle } from "@/lib/articles";
import type { SelectableItem } from "./command-items";

// ---- OptionRow -----------------------------------------------------------

interface OptionRowProps {
  item: SelectableItem;
  isActive: boolean;
  onActivate: () => void;
  onHover: () => void;
  children: React.ReactNode;
}

export function OptionRow({
  item,
  isActive,
  onActivate,
  onHover,
  children,
}: OptionRowProps) {
  return (
    <div
      id={item.ariaId}
      role="option"
      aria-selected={isActive}
      className={cn(
        "flex items-center gap-[var(--space-3)] w-full cursor-pointer",
        "min-h-[44px] px-[var(--space-3)] py-[var(--space-2)]",
        "rounded-[var(--radius-md)]",
        "transition-[background,box-shadow] [transition-duration:var(--duration-fast)]",
        "motion-reduce:transition-none",
        isActive && [
          "bg-[color-mix(in_srgb,var(--primary)_12%,transparent)]",
          "shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_30%,transparent)]",
        ],
      )}
      onMouseMove={onHover}
      onClick={onActivate}
    >
      {children}
    </div>
  );
}

// ---- CommandResultSkeleton -----------------------------------------------

export function CommandResultSkeleton() {
  return (
    <div
      className="flex items-center gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)] min-h-[44px]"
      aria-hidden
    >
      <Skeleton shape="block" className="w-5 h-5 shrink-0 rounded-[var(--radius-sm)]" />
      <Skeleton shape="text" className="flex-1 h-4 max-w-[55%]" />
      <div className="hidden sm:flex gap-[var(--space-2)] shrink-0">
        <Skeleton shape="block" className="w-8 h-5 rounded-[var(--radius-full)]" />
        <Skeleton shape="block" className="w-14 h-5 rounded-[var(--radius-full)]" />
      </div>
    </div>
  );
}

// ---- GroupHeader ---------------------------------------------------------

interface GroupHeaderProps {
  id: string;
  label: string;
  hasBorderTop: boolean;
}

export function GroupHeader({ id, label, hasBorderTop }: GroupHeaderProps) {
  return (
    <li
      role="presentation"
      id={id}
      className={cn(hasBorderTop && "border-t border-border mt-[var(--space-1)]")}
    >
      <span className="block text-[length:var(--text-xs)] font-semibold uppercase tracking-wide text-text-subtle px-[var(--space-3)] py-[var(--space-1)] pt-[var(--space-2)]">
        {label}
      </span>
    </li>
  );
}

// ---- ArticleMeta ---------------------------------------------------------

export function ArticleMeta({ article }: { article: ListingArticle }) {
  const category = article.category
    ? CATEGORIES.find((c) => c.slug === article.category)?.label
    : null;
  const isCefr =
    article.difficulty != null &&
    (CEFR_LEVELS as readonly string[]).includes(article.difficulty);

  if (!isCefr && !category && article.readingMinutes == null) return null;

  return (
    <div
      className="hidden min-[380px]:flex items-center gap-[var(--space-2)] shrink-0 pointer-events-none"
      aria-hidden
    >
      {isCefr && <CefrBadge level={article.difficulty as CefrLevel} />}
      {category && <CategoryBadge>{category}</CategoryBadge>}
      {article.readingMinutes != null && (
        <span className="hidden sm:inline text-[length:var(--text-xs)] text-text-subtle whitespace-nowrap">
          {article.readingMinutes} min
        </span>
      )}
    </div>
  );
}
