import { ListingLoadingShell } from "@/components/route-states";

const BROWSE_TAB_COUNT = 6;
const BROWSE_CARD_COUNT = 9;

/** Suspense fallback for the browse / category-browsing page. */
export default function BrowseLoading() {
  return (
    <ListingLoadingShell tabCount={BROWSE_TAB_COUNT} cardCount={BROWSE_CARD_COUNT} />
  );
}
