import { Skeleton } from "@/components/ui/Skeleton";

/** Suspense fallback for admin section pages. */
export default function AdminLoading() {
  return (
    <div aria-hidden style={{ marginTop: "var(--space-6)" }}>
      {/* Search bar placeholder */}
      <div className="admin-search mb-[var(--space-4)]">
        <Skeleton shape="block" className="h-10 w-72 rounded-[var(--radius-md)]" />
      </div>

      {/* Table skeleton */}
      <div className="border border-border rounded-[var(--radius-lg)] overflow-hidden">
        {/* Header row */}
        <div className="flex gap-[var(--space-4)] px-[var(--space-4)] py-[var(--space-3)] bg-bg-subtle border-b border-border">
          {[140, 200, 80, 80].map((w, i) => (
            <Skeleton
              key={i}
              shape="block"
              className="h-4 rounded-[var(--radius-sm)]"
              style={{ width: `${w}px` }}
            />
          ))}
        </div>

        {/* Data rows */}
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex gap-[var(--space-4)] px-[var(--space-4)] py-[var(--space-3)] border-b border-border last:border-b-0"
          >
            {[140, 200, 80, 80].map((w, j) => (
              <Skeleton
                key={j}
                shape="block"
                className="h-4 rounded-[var(--radius-sm)]"
                style={{ width: `${w}px` }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
