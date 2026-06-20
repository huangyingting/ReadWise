import { SkeletonCardGrid } from "@/components/SkeletonCard";
import { Skeleton } from "@/components/ui/Skeleton";

/** Suspense fallback for the dashboard page. */
export default function DashboardLoading() {
  return (
    <div className="listing-container" aria-hidden>
      {/* Page heading placeholder */}
      <Skeleton shape="block" className="h-9 w-40 mb-[var(--space-6)]" />

      {/* Identity card placeholder */}
      <div className="bg-surface border border-border rounded-[var(--radius-lg)] p-[var(--space-5)] flex items-center gap-[var(--space-4)] mb-[var(--space-6)]">
        <Skeleton shape="block" className="h-14 w-14 rounded-full flex-shrink-0" />
        <div className="flex flex-col gap-[var(--space-2)] flex-1">
          <Skeleton shape="text" className="w-1/3" />
          <Skeleton shape="text" className="w-1/2" />
        </div>
      </div>

      <SkeletonCardGrid count={6} />
    </div>
  );
}
