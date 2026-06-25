"use client";

/**
 * ListingSync — convenience wrapper that mounts both ListingProgressSync and
 * ListingBookmarkSync for a listing page (REF-058).
 *
 * Every listing page that renders ArticleCardView cards with both progress and
 * bookmark overlays should use this component instead of mounting the two sync
 * components separately.
 *
 * Both underlying components render null; this component also renders null.
 */

import ListingProgressSync from "@/components/ListingProgressSync";
import ListingBookmarkSync from "@/components/ListingBookmarkSync";

export default function ListingSync({
  articleIds,
}: {
  articleIds: string[];
}) {
  return (
    <>
      <ListingProgressSync articleIds={articleIds} />
      <ListingBookmarkSync articleIds={articleIds} />
    </>
  );
}
