/**
 * Shared loading-page shell for listing routes (REF-063).
 *
 * Renders a heading placeholder followed by an optional subtitle and tab-strip
 * skeleton and a card-grid skeleton. Covers the common case shared by the (app)
 * group fallback and simple listing pages (e.g. tags).
 *
 * Pages with richer loading states (notes, progress, study, reader, admin)
 * keep their own per-page loading.tsx with the full layout.
 */

import { SkeletonCardGrid } from "@/components/SkeletonCard";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";

export interface ListingLoadingShellProps {
  /** Width class for the heading placeholder. Defaults to "w-48". */
  headingWidthClass?: string;
  /** When true, renders a subtitle skeleton row below the heading. */
  subtitle?: boolean;
  /** Number of tab-strip pill skeletons to render (0 = none). */
  tabCount?: number;
  /** Number of card skeletons. Defaults to 6. */
  cardCount?: number;
}

export function ListingLoadingShell({
  headingWidthClass = "w-48",
  subtitle = false,
  tabCount = 0,
  cardCount = 6,
}: ListingLoadingShellProps) {
  return (
    <div className="listing-container" aria-hidden>
      {/* Page heading placeholder */}
      <Skeleton
        shape="block"
        className={cn(
          "h-9",
          headingWidthClass,
          subtitle ? "mb-[var(--space-2)]" : "mb-[var(--space-6)]",
        )}
      />

      {subtitle && (
        <Skeleton shape="text" className="w-1/3 mb-[var(--space-6)]" />
      )}

      {tabCount > 0 && (
        <div className="flex gap-[var(--space-2)] mb-[var(--space-6)] overflow-hidden">
          {Array.from({ length: tabCount }).map((_, i) => (
            <Skeleton
              key={i}
              shape="block"
              className="h-8 rounded-full flex-shrink-0"
              style={{ width: `${60 + i * 10}px` }}
            />
          ))}
        </div>
      )}

      <SkeletonCardGrid count={cardCount} />
    </div>
  );
}
