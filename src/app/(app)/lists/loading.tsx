import { SkeletonCardGrid } from "@/components/SkeletonCard";
import { Skeleton } from "@/components/ui/Skeleton";

/** Suspense fallback for the saved articles / lists page. */
export default function ListsLoading() {
  return (
    <div className="listing-container" aria-hidden>
      {/* Page heading */}
      <Skeleton shape="block" className="h-9 w-32 mb-[var(--space-6)]" />

      {/* List switcher tabs */}
      <div className="flex gap-[var(--space-2)] mb-[var(--space-6)]">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton
            key={i}
            shape="block"
            className="h-8 rounded-full"
            style={{ width: `${64 + i * 20}px` }}
          />
        ))}
      </div>

      <SkeletonCardGrid count={6} />
    </div>
  );
}
