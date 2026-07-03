import { ListingLoadingShell } from "@/components/route-states";

const LISTS_HEADING_WIDTH_CLASS = "w-32";
const LISTS_TAB_COUNT = 3;
const LISTS_CARD_COUNT = 6;

/** Suspense fallback for the saved articles / lists page. */
export default function ListsLoading() {
  return (
    <ListingLoadingShell
      headingWidthClass={LISTS_HEADING_WIDTH_CLASS}
      tabCount={LISTS_TAB_COUNT}
      cardCount={LISTS_CARD_COUNT}
    />
  );
}
