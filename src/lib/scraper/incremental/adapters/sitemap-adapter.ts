/**
 * Sitemap canary adapter (issue #1090, Phase 1.10).
 *
 * Reads ONE sitemap document (`<urlset>`) via the injected SSRF-safe discovery
 * fetch and maps its `<url>` entries to sanitized {@link DiscoveryPageItem}s,
 * reusing the existing `parseSitemapEntries` (`providers/shared.ts`). A sitemap
 * `<lastmod>` is a page-metadata date; when the channel's date-trust policy is
 * `trusted` it is carried as a `PAGE_METADATA` provenance. NEVER fetches an
 * article body — only the one sitemap document.
 */
import { CandidateDateProvenance } from "@prisma/client";

import { parseSitemapEntries } from "@/lib/scraper/providers/shared";
import type { DiscoveryPageItem } from "@/lib/scraper/incremental/classify";
import type { DiscoveryPageFetcher } from "@/lib/scraper/incremental/discovery-run";

import {
  buildCanaryFetcher,
  type CanaryAdapterConfig,
  type CanaryAdapterDeps,
} from "./types";

/** Maps a parsed sitemap body to page items (pure, no fetch). */
export function mapSitemapBody(body: string, config: CanaryAdapterConfig): DiscoveryPageItem[] {
  const entries = parseSitemapEntries(body);
  return entries.map((entry, index): DiscoveryPageItem => {
    const publishedAt =
      config.dateTrust === "trusted" && entry.lastModified && !Number.isNaN(Date.parse(entry.lastModified))
        ? new Date(entry.lastModified)
        : undefined;
    return {
      url: entry.url,
      positionRank: index,
      ...(publishedAt ? { publishedAt, dateProvenance: CandidateDateProvenance.PAGE_METADATA } : {}),
    };
  });
}

/** Builds a sitemap canary {@link DiscoveryPageFetcher} for the given config. */
export function makeSitemapCanaryAdapter(
  config: CanaryAdapterConfig,
  deps: CanaryAdapterDeps,
): DiscoveryPageFetcher {
  return buildCanaryFetcher(config, deps, mapSitemapBody);
}
