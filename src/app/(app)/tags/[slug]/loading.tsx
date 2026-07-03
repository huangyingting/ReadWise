import { ListingLoadingShell } from "@/components/route-states";

const TAG_LOADING_CARD_COUNT = 6;

/** Suspense fallback for the tag-browsing page. */
export default function TagLoading() {
  return (
    <ListingLoadingShell
      headingWidthClass="w-56"
      subtitle
      cardCount={TAG_LOADING_CARD_COUNT}
    />
  );
}
