/** Production adapter selection for the worker's bounded discovery pass. */
import { fetchDiscoveryResponse, type DiscoveryFetch } from "@/lib/scraper/fetch";
import {
  selectCanaryAdapterForSource,
} from "@/lib/scraper/incremental/canaries";
import type { DiscoveryPageFetcher } from "@/lib/scraper/incremental/discovery-run";

export type ProductionDiscoveryDeps = {
  fetchResponse?: DiscoveryFetch;
};

/**
 * Builds the production page fetcher used by the worker. Source rows are routed
 * through the checked-in, versioned adapter registry; an unregistered source
 * fails closed and is handled by the discovery run's normal backoff path.
 */
export function createProductionDiscoveryFetcher(
  deps: ProductionDiscoveryDeps = {},
): DiscoveryPageFetcher {
  const fetchResponse = deps.fetchResponse ?? fetchDiscoveryResponse;

  return async (input) => {
    const fetchPage = selectCanaryAdapterForSource(input.source, { fetchResponse });
    if (!fetchPage) {
      throw new Error("no production discovery adapter registered for source");
    }
    return fetchPage(input);
  };
}

export const fetchProductionDiscoveryPage = createProductionDiscoveryFetcher();
