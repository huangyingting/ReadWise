import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

/**
 * Reader-segment Suspense fallback. Mirrors the reader column layout
 * so the page doesn't reflow when the real article lands.
 */
export default function ReaderLoading() {
  return (
    <div className="reader-layout">
      <div className="reader-column">
        {/* Article header skeleton */}
        <div className="reader-article-header" aria-hidden>
          {/* CEFR badge + reading time */}
          <div className="flex gap-[var(--space-2)] mb-[var(--space-4)]">
            <Skeleton shape="block" className="h-5 w-10 rounded-full" />
            <Skeleton shape="block" className="h-5 w-20 rounded-full" />
          </div>

          {/* Title: 2–3 lines */}
          <SkeletonText lines={2} className="mb-[var(--space-3)]" />

          {/* Byline */}
          <Skeleton shape="text" className="w-1/3 mb-[var(--space-6)]" />
        </div>

        {/* Article body: several paragraphs */}
        <div className="flex flex-col gap-[var(--space-6)]" aria-hidden>
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonText key={i} lines={i === 2 ? 2 : 4} />
          ))}
        </div>
      </div>
    </div>
  );
}
