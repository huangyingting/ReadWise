import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";

/**
 * Skeleton placeholder that mirrors the M4 ArticleCardView footprint so the
 * listing grid doesn't reflow when real cards land. Built from M1 Skeleton
 * primitives (shimmer + reduced-motion already handled).
 *
 * Includes a 16:9 image-slot placeholder matching ArticleCardView's thumbnail
 * so there's no layout shift when real cards load.
 */
export function SkeletonCard({
  className,
}: {
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex flex-col gap-[var(--space-3)]",
        "bg-surface border border-border rounded-[var(--radius-lg)] shadow-[var(--shadow-sm)]",
        "overflow-hidden",
        "h-full",
        className,
      )}
    >
      {/* 16:9 thumbnail placeholder — matches ArticleCardView's ArticleHero thumb */}
      <Skeleton
        shape="block"
        className="w-full aspect-[16/9] rounded-none"
      />

      {/* Card body */}
      <div className="flex flex-col gap-[var(--space-3)] p-[var(--space-5)] sm:p-[var(--space-6)] pt-[var(--space-3)]">
        {/* Top row: badge chip + meta chip */}
        <div className="flex items-center gap-[var(--space-2)]">
          <Skeleton shape="block" className="h-5 w-12 rounded-full" />
          <Skeleton shape="block" className="h-4 w-24 rounded-[var(--radius-sm)]" />
        </div>

        {/* Title: 2 lines */}
        <SkeletonText lines={2} />

        {/* Byline: 1 line at 50% */}
        <Skeleton shape="text" className="w-1/2" />

        {/* Progress track pinned to bottom */}
        <Skeleton
          shape="block"
          className="mt-auto h-1.5 w-full rounded-full"
        />
      </div>
    </div>
  );
}

/**
 * Convenience wrapper: renders `count` SkeletonCards inside the §2.1 grid.
 * Drop in place of a card grid while loading.
 */
export function SkeletonCardGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[var(--space-4)] sm:gap-[var(--space-5)] lg:gap-[var(--space-6)]">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
