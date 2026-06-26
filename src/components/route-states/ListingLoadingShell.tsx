/**
 * Shared loading-page shell for listing routes (REF-063).
 *
 * Renders a heading placeholder followed by an optional subtitle, an optional
 * filter bar slot, an optional tab-strip skeleton, optional stat-card skeletons,
 * and finally either a custom `children` slot or a card-grid skeleton.
 *
 * Pages with richer loading states (notes, progress, study, reader, admin)
 * may use the `filterBar` or `children` slots to provide bespoke content.
 * The reader loading state keeps its own per-page loading.tsx with the full
 * layout.
 */

import { SkeletonCardGrid } from "@/components/SkeletonCard";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";

export interface ListingLoadingShellProps {
  /**
   * Width class for the heading placeholder (e.g. "w-48"). When omitted the
   * heading row is not rendered — useful for pages (e.g. browse) whose real
   * page has no visible heading at load time.
   */
  headingWidthClass?: string;
  /** When true, renders a subtitle skeleton row below the heading. */
  subtitle?: boolean;
  /** Number of tab-strip pill skeletons to render (0 = none). */
  tabCount?: number;
  /** Number of card skeletons. Defaults to 6. Ignored when `children` is given. */
  cardCount?: number;
  /**
   * Optional custom filter bar slot rendered below the heading/subtitle and
   * above any tab strip. Pass a ReactNode to replace the default empty area
   * with a bespoke filter skeleton (e.g. search input + select row for notes).
   */
  filterBar?: React.ReactNode;
  /**
   * Number of stat-card skeleton cells to render in a 2-col/4-col grid above
   * the main content area (e.g. 4 for the progress page).
   */
  statCardCount?: number;
  /**
   * Custom content slot. When provided it replaces the `SkeletonCardGrid`
   * entirely, allowing per-route skeletons (word-list rows, note groups, etc.)
   * while still reusing the heading, tab strip, and filter bar scaffolding.
   */
  children?: React.ReactNode;
}

export function ListingLoadingShell({
  headingWidthClass,
  subtitle = false,
  tabCount = 0,
  cardCount = 6,
  filterBar,
  statCardCount,
  children,
}: ListingLoadingShellProps) {
  return (
    <div className="listing-container" aria-hidden>
      {/* Page heading placeholder — omitted when headingWidthClass is not set */}
      {headingWidthClass && (
        <Skeleton
          shape="block"
          className={cn(
            "h-9",
            headingWidthClass,
            subtitle || filterBar ? "mb-[var(--space-2)]" : "mb-[var(--space-6)]",
          )}
        />
      )}

      {subtitle && (
        <Skeleton shape="text" className="w-1/3 mb-[var(--space-6)]" />
      )}

      {filterBar && (
        <div className="mb-[var(--space-6)]">{filterBar}</div>
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

      {statCardCount && statCardCount > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-[var(--space-4)] mb-[var(--space-6)]">
          {Array.from({ length: statCardCount }).map((_, i) => (
            <div
              key={i}
              className="bg-surface border border-border rounded-[var(--radius-lg)] p-[var(--space-4)] flex flex-col gap-[var(--space-2)]"
            >
              <Skeleton shape="text" className="w-2/3 h-4" />
              <Skeleton shape="block" className="h-8 w-3/4 rounded-[var(--radius-sm)]" />
            </div>
          ))}
        </div>
      ) : null}

      {children ?? <SkeletonCardGrid count={cardCount} />}
    </div>
  );
}
