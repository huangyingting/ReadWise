import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

/** Suspense fallback for the notes & highlights page. */
export default function NotesLoading() {
  return (
    <div className="listing-container" aria-hidden>
      {/* Page heading */}
      <Skeleton shape="block" className="h-9 w-48 mb-[var(--space-6)]" />

      {/* Filter bar */}
      <div className="flex gap-[var(--space-2)] mb-[var(--space-6)]">
        <Skeleton shape="block" className="h-9 flex-1 max-w-xs rounded-[var(--radius-md)]" />
        <Skeleton shape="block" className="h-9 w-24 rounded-[var(--radius-md)]" />
      </div>

      {/* Note card group */}
      <div className="flex flex-col gap-[var(--space-4)]">
        {Array.from({ length: 3 }).map((_, gi) => (
          <div key={gi} className="flex flex-col gap-[var(--space-3)]">
            {/* Article title heading */}
            <Skeleton shape="text" className="w-1/3 h-5" />
            {/* Note cards */}
            {Array.from({ length: gi === 0 ? 3 : 2 }).map((__, i) => (
              <div
                key={i}
                className="bg-surface border border-border rounded-[var(--radius-lg)] p-[var(--space-4)] flex flex-col gap-[var(--space-2)]"
              >
                <Skeleton shape="block" className="h-3 w-10 rounded-full" />
                <SkeletonText lines={2} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
