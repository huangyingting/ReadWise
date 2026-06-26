import { ListingLoadingShell } from "@/components/route-states";
import { Skeleton } from "@/components/ui/Skeleton";

/** Suspense fallback for the study / saved-words page. */
export default function StudyLoading() {
  return (
    <ListingLoadingShell headingWidthClass="w-48">
      <div className="flex flex-col gap-[var(--space-3)]">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="bg-surface border border-border rounded-[var(--radius-lg)] p-[var(--space-4)] flex flex-col gap-[var(--space-2)]"
          >
            <Skeleton shape="text" className="w-1/4 h-5" />
            <Skeleton shape="text" className="w-3/4" />
            <Skeleton shape="text" className="w-1/2" />
          </div>
        ))}
      </div>
    </ListingLoadingShell>
  );
}
