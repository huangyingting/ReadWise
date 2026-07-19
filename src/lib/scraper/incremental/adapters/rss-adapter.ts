/**
 * RSS canary adapter (issue #1090, Phase 1.10).
 *
 * Reads ONE RSS 2.0 / Atom feed document via the injected SSRF-safe discovery
 * fetch and maps its entries to sanitized {@link DiscoveryPageItem}s, reusing the
 * existing `parseRssEntries` (`rss.ts`). A feed entry carries a TRUSTED
 * publication date (`<pubDate>` / `<published>`), so items get a `FEED`
 * provenance when the channel's date-trust policy is `trusted`. NEVER fetches an
 * article body — only the one feed document.
 */
import { CandidateDateProvenance } from "@prisma/client";

import { parseRssEntries } from "@/lib/scraper/rss";
import type { DiscoveryPageItem } from "@/lib/scraper/incremental/classify";
import type { DiscoveryPageFetcher } from "@/lib/scraper/incremental/discovery-run";

import {
  buildCanaryFetcher,
  type CanaryAdapterConfig,
  type CanaryAdapterDeps,
} from "./types";

/** Maps a parsed RSS feed body to page items (pure, no fetch). */
export function mapRssBody(body: string, config: CanaryAdapterConfig): DiscoveryPageItem[] {
  const entries = parseRssEntries(body);
  return entries.map((entry, index): DiscoveryPageItem => {
    const publishedAt =
      config.dateTrust === "trusted" && entry.publishedAt && !Number.isNaN(Date.parse(entry.publishedAt))
        ? new Date(entry.publishedAt)
        : undefined;
    return {
      url: entry.url,
      positionRank: index,
      ...(publishedAt ? { publishedAt, dateProvenance: CandidateDateProvenance.FEED } : {}),
    };
  });
}

/** Builds an RSS canary {@link DiscoveryPageFetcher} for the given config. */
export function makeRssCanaryAdapter(
  config: CanaryAdapterConfig,
  deps: CanaryAdapterDeps,
): DiscoveryPageFetcher {
  return buildCanaryFetcher(config, deps, mapRssBody);
}
