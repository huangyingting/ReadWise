import { ListingLoadingShell } from "@/components/route-states";
import { Skeleton } from "@/components/ui/Skeleton";

const STUDY_SKELETON_COUNT = 8;
const STUDY_TEXT_WIDTHS = ["w-1/4 h-5", "w-3/4", "w-1/2"] as const;

/** Suspense fallback for the study / saved-words page. */
export default function StudyLoading() {
  return (
    <ListingLoadingShell headingWidthClass="w-48">
      <div className="flex flex-col gap-[var(--space-3)]">
        {Array.from({ length: STUDY_SKELETON_COUNT }).map((_, i) => (
          <div
            key={i}
            className="bg-surface border border-border rounded-[var(--radius-lg)] p-[var(--space-4)] flex flex-col gap-[var(--space-2)]"
          >
            {STUDY_TEXT_WIDTHS.map((className) => (
              <Skeleton key={className} shape="text" className={className} />
            ))}
          </div>
        ))}
      </div>
    </ListingLoadingShell>
  );
}
