import { ListingLoadingShell } from "@/components/route-states";

const APP_LOADING_HEADING_WIDTH_CLASS = "w-48";
const APP_LOADING_CARD_COUNT = 6;

/**
 * Group-level Suspense fallback for the (app) route group.
 * Shown while any page in this group is streaming its server render.
 * Per-route loading.tsx files take priority for specific segments.
 */
export default function AppLoading() {
  return (
    <ListingLoadingShell
      headingWidthClass={APP_LOADING_HEADING_WIDTH_CLASS}
      cardCount={APP_LOADING_CARD_COUNT}
    />
  );
}
