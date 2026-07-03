import { ListingLoadingShell } from "@/components/route-states";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

const NOTE_GROUP_CARD_COUNTS = [3, 2, 2] as const;

/** Suspense fallback for the notes & highlights page. */
export default function NotesLoading() {
  return (
    <ListingLoadingShell
      headingWidthClass="w-48"
      filterBar={
        <div className="flex gap-[var(--space-2)]">
          <Skeleton shape="block" className="h-9 flex-1 max-w-xs rounded-[var(--radius-md)]" />
          <Skeleton shape="block" className="h-9 w-24 rounded-[var(--radius-md)]" />
        </div>
      }
    >
      {/* Note card groups */}
      <div className="flex flex-col gap-[var(--space-4)]">
        {NOTE_GROUP_CARD_COUNTS.map((cardCount, groupIndex) => (
          <div key={groupIndex} className="flex flex-col gap-[var(--space-3)]">
            <Skeleton shape="text" className="w-1/3 h-5" />
            {Array.from({ length: cardCount }).map((_, cardIndex) => (
              <div
                key={cardIndex}
                className="bg-surface border border-border rounded-[var(--radius-lg)] p-[var(--space-4)] flex flex-col gap-[var(--space-2)]"
              >
                <Skeleton shape="block" className="h-3 w-10 rounded-full" />
                <SkeletonText lines={2} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </ListingLoadingShell>
  );
}
