import { SkeletonCardGrid } from "@/components/SkeletonCard";
import { Skeleton } from "@/components/ui/Skeleton";

/** Suspense fallback for the tag-browsing page. */
export default function TagLoading() {
  return (
    <div className="listing-container" aria-hidden>
      <Skeleton shape="block" className="h-9 w-56 mb-[var(--space-2)]" />
      <Skeleton shape="text" className="w-1/3 mb-[var(--space-6)]" />
      <SkeletonCardGrid count={6} />
    </div>
  );
}
