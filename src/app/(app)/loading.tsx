import { SkeletonCardGrid } from "@/components/SkeletonCard";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Group-level Suspense fallback for the (app) route group.
 * Shown while any page in this group is streaming its server render.
 * Per-route loading.tsx files take priority for specific segments.
 */
export default function AppLoading() {
  return (
    <div className="listing-container">
      {/* Page heading placeholder */}
      <Skeleton shape="block" className="h-9 w-48 mb-[var(--space-6)]" />
      <SkeletonCardGrid count={6} />
    </div>
  );
}
