import { SkeletonCardGrid } from "@/components/SkeletonCard";
import { Skeleton } from "@/components/ui/Skeleton";

/** Suspense fallback for the browse / category-browsing page. */
export default function BrowseLoading() {
  return (
    <div className="listing-container" aria-hidden>
      {/* Category tab bar placeholder */}
      <div className="flex gap-[var(--space-2)] mb-[var(--space-6)] overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton
            key={i}
            shape="block"
            className="h-8 rounded-full flex-shrink-0"
            style={{ width: `${60 + i * 10}px` }}
          />
        ))}
      </div>

      <SkeletonCardGrid count={9} />
    </div>
  );
}
