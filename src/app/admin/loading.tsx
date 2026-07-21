import { Skeleton } from "@/components/ui/Skeleton";

const ADMIN_SKELETON_WIDTHS = [140, 200, 80, 80] as const;
const ADMIN_DATA_ROW_COUNT = 8;

function AdminLoadingCells() {
  return (
    <>
      {ADMIN_SKELETON_WIDTHS.map((w, i) => (
        <Skeleton
          key={i}
          shape="block"
          className="h-4 rounded-[var(--radius-sm)]"
          style={{ width: `${w}px` }}
        />
      ))}
    </>
  );
}

/** Suspense fallback for admin section pages. */
export default function AdminLoading() {
  return (
    <div className="mt-[var(--space-6)]" aria-busy="true">
      <span className="sr-only" role="status">
        Loading admin page
      </span>
      <div aria-hidden>
        {/* Search bar placeholder */}
        <div className="admin-search mb-[var(--space-4)]">
          <Skeleton shape="block" className="h-10 w-72 rounded-[var(--radius-md)]" />
        </div>

        {/* Table skeleton */}
        <div className="border border-border rounded-[var(--radius-lg)] overflow-hidden">
          {/* Header row */}
          <div className="flex gap-[var(--space-4)] px-[var(--space-4)] py-[var(--space-3)] bg-bg-subtle border-b border-border">
            <AdminLoadingCells />
          </div>

          {/* Data rows */}
          {Array.from({ length: ADMIN_DATA_ROW_COUNT }).map((_, i) => (
            <div
              key={i}
              className="flex gap-[var(--space-4)] px-[var(--space-4)] py-[var(--space-3)] border-b border-border last:border-b-0"
            >
              <AdminLoadingCells />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
