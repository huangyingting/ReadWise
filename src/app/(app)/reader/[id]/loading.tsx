import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

/**
 * Reader-segment Suspense fallback. Mirrors the full reader column layout —
 * including the sticky toolbar and the article header action row — so the page
 * doesn't pop in when the real article lands.
 */
export default function ReaderLoading() {
  return (
    <div className="reader-layout">
      <div className="reader-column">
        {/* ── Sticky toolbar skeleton: Back · Listen · Aa · Tools ── */}
        <div className="reader-controls" aria-hidden>
          {/* Back button placeholder */}
          <Skeleton shape="block" className="h-8 w-20 rounded-[var(--radius-md)]" />

          {/* Right-side action buttons */}
          <div className="reader-controls-actions">
            <Skeleton shape="block" className="h-8 w-8 rounded-[var(--radius-md)]" />
            <Skeleton shape="block" className="h-8 w-8 rounded-[var(--radius-md)]" />
            <Skeleton shape="block" className="h-8 w-8 rounded-[var(--radius-md)]" />
          </div>
        </div>

        {/* ── Article header skeleton ── */}
        <div className="reader-article-header" aria-hidden>
          {/* Title: 2 lines */}
          <SkeletonText lines={2} className="mb-[var(--space-3)]" />

          {/* Byline */}
          <Skeleton shape="text" className="w-2/5 mb-[var(--space-4)]" />

          {/* Meta + action row: CEFR badge · reading time · bookmark */}
          <div className="flex items-center gap-[var(--space-2)] mb-[var(--space-6)]">
            <Skeleton shape="block" className="h-5 w-10 rounded-full" />
            <Skeleton shape="block" className="h-5 w-20 rounded-full" />
            <Skeleton shape="block" className="h-7 w-7 rounded-[var(--radius-md)] ml-auto" />
          </div>
        </div>

        {/* ── Article body: several paragraphs ── */}
        <div className="flex flex-col gap-[var(--space-6)]" aria-hidden>
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonText key={i} lines={i === 2 ? 2 : 4} />
          ))}
        </div>
      </div>
    </div>
  );
}
