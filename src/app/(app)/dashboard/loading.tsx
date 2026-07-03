import { ListingLoadingShell } from "@/components/route-states";
import { Skeleton } from "@/components/ui/Skeleton";

const DASHBOARD_CARD_COUNT = 6;
const DASHBOARD_CARD_INDEXES = Array.from(
  { length: DASHBOARD_CARD_COUNT },
  (_, index) => index,
);

function DashboardIdentitySkeleton() {
  return (
    <div className="bg-surface border border-border rounded-[var(--radius-lg)] p-[var(--space-5)] flex items-center gap-[var(--space-4)] mb-[var(--space-6)]">
      <Skeleton shape="block" className="h-14 w-14 rounded-full flex-shrink-0" />
      <div className="flex flex-col gap-[var(--space-2)] flex-1">
        <Skeleton shape="text" className="w-1/3" />
        <Skeleton shape="text" className="w-1/2" />
      </div>
    </div>
  );
}

function DashboardCardSkeletonGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[var(--space-4)]">
      {DASHBOARD_CARD_INDEXES.map((index) => (
        <div
          key={index}
          className="bg-surface border border-border rounded-[var(--radius-lg)] p-[var(--space-4)] flex flex-col gap-[var(--space-3)]"
        >
          <Skeleton shape="text" className="w-3/4" />
          <Skeleton shape="text" className="w-1/2" />
        </div>
      ))}
    </div>
  );
}

/** Suspense fallback for the dashboard page. */
export default function DashboardLoading() {
  return (
    <ListingLoadingShell headingWidthClass="w-40" cardCount={DASHBOARD_CARD_COUNT}>
      <DashboardIdentitySkeleton />
      <DashboardCardSkeletonGrid />
    </ListingLoadingShell>
  );
}
