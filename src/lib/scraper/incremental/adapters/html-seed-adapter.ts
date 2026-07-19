/**
 * Seed-HTML canary adapter (issue #1090, Phase 1.10).
 *
 * Reads ONE seed index page (a section / landing HTML document) via the injected
 * SSRF-safe discovery fetch and maps its anchor links to sanitized
 * {@link DiscoveryPageItem}s, reusing the existing `hrefsFromHtml`
 * (`providers/shared.ts`) to resolve relative hrefs against the seed URL. A seed
 * index carries NO trusted per-item publication date, so items are emitted
 * UNDATED (provenance `UNKNOWN`) — which the classifier treats as
 * `review-required` in ACTIVE mode rather than silently windowing them. NEVER
 * fetches an article body — only the one seed index document.
 */
import { hrefsFromHtml } from "@/lib/scraper/providers/shared";
import type { DiscoveryPageItem } from "@/lib/scraper/incremental/classify";
import type { DiscoveryPageFetcher } from "@/lib/scraper/incremental/discovery-run";

import {
  buildCanaryFetcher,
  type CanaryAdapterConfig,
  type CanaryAdapterDeps,
} from "./types";

/** Maps a seed index page body to page items (pure, no fetch). */
export function mapSeedHtmlBody(body: string, config: CanaryAdapterConfig): DiscoveryPageItem[] {
  const hrefs = hrefsFromHtml(body, config.documentUrl);
  const seen = new Set<string>();
  const items: DiscoveryPageItem[] = [];
  for (const url of hrefs) {
    if (seen.has(url)) continue;
    seen.add(url);
    items.push({ url, positionRank: items.length });
  }
  return items;
}

/** Builds a seed-HTML canary {@link DiscoveryPageFetcher} for the given config. */
export function makeSeedHtmlCanaryAdapter(
  config: CanaryAdapterConfig,
  deps: CanaryAdapterDeps,
): DiscoveryPageFetcher {
  return buildCanaryFetcher(config, deps, mapSeedHtmlBody);
}
