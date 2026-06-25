import { ListingLoadingShell } from "@/components/route-states";

/**
 * Group-level Suspense fallback for the (app) route group.
 * Shown while any page in this group is streaming its server render.
 * Per-route loading.tsx files take priority for specific segments.
 */
export default function AppLoading() {
  return <ListingLoadingShell headingWidthClass="w-48" cardCount={6} />;
}
