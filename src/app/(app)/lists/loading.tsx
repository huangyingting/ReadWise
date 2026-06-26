import { ListingLoadingShell } from "@/components/route-states";

/** Suspense fallback for the saved articles / lists page. */
export default function ListsLoading() {
  return (
    <ListingLoadingShell headingWidthClass="w-32" tabCount={3} cardCount={6} />
  );
}
