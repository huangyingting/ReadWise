import { ListingLoadingShell } from "@/components/route-states";

/** Suspense fallback for the browse / category-browsing page. */
export default function BrowseLoading() {
  return (
    <ListingLoadingShell tabCount={6} cardCount={9} />
  );
}
