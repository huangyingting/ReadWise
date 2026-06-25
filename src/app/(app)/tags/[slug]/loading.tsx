import { ListingLoadingShell } from "@/components/route-states";

/** Suspense fallback for the tag-browsing page. */
export default function TagLoading() {
  return (
    <ListingLoadingShell headingWidthClass="w-56" subtitle cardCount={6} />
  );
}
