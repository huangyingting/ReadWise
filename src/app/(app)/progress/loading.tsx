import { Skeleton } from "@/components/ui/Skeleton";

/** Suspense fallback for the progress / learner analytics page. */
export default function ProgressLoading() {
  return (
    <div className="listing-container" aria-hidden>
      {/* Page heading */}
      <Skeleton shape="block" className="h-9 w-48 mb-[var(--space-6)]" />

      {/* Stat cards row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-[var(--space-4)] mb-[var(--space-8)]">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-surface border border-border rounded-[var(--radius-lg)] p-[var(--space-4)] flex flex-col gap-[var(--space-2)]"
          >
            <Skeleton shape="text" className="w-2/3 h-4" />
            <Skeleton shape="block" className="h-8 w-3/4 rounded-[var(--radius-sm)]" />
          </div>
        ))}
      </div>

      {/* Weekly activity chart placeholder */}
      <div className="bg-surface border border-border rounded-[var(--radius-lg)] p-[var(--space-6)] mb-[var(--space-8)]">
        <Skeleton shape="text" className="w-1/4 h-5 mb-[var(--space-4)]" />
        <div className="flex items-end gap-[var(--space-2)] h-32">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton
              key={i}
              shape="block"
              className="flex-1 rounded-t-sm"
              style={{ height: `${30 + ((i * 17) % 70)}%` }}
            />
          ))}
        </div>
      </div>

      {/* Recent articles section */}
      <Skeleton shape="text" className="w-1/3 h-5 mb-[var(--space-4)]" />
      <div className="flex flex-col gap-[var(--space-3)]">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="bg-surface border border-border rounded-[var(--radius-lg)] p-[var(--space-4)] flex items-center gap-[var(--space-4)]"
          >
            <div className="flex-1 flex flex-col gap-[var(--space-2)]">
              <Skeleton shape="text" className="w-3/4 h-4" />
              <Skeleton shape="text" className="w-1/4 h-3" />
            </div>
            <Skeleton shape="block" className="h-6 w-12 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
