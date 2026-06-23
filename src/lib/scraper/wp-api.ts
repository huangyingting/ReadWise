/**
 * WordPress REST API URL extractor for the Nautilus provider.
 *
 * Fetches recent posts from the WP v2 `/posts` endpoint, optionally filtered
 * by WP category ID, and returns the `link` field of each post. Pagination is
 * handled transparently up to a safety page cap.
 *
 * Category channel → WP category ID mapping:
 * These IDs are specific to https://nautil.us. Verify against:
 *   curl https://nautil.us/wp-json/wp/v2/categories?per_page=100 | jq '.[] | {id, slug}'
 */

import type { ExtractorFetch } from "@/lib/scraper/types";
import { createLogger } from "@/lib/logger";

const log = createLogger("scraper.nautilus");

/** Base URL for the Nautilus WordPress REST API. */
export const NAUTILUS_WP_API_BASE = "https://nautil.us/wp-json/wp/v2/posts";

/**
 * Nautilus section slug → WordPress category ID mapping.
 *
 * These IDs were derived from the Nautilus WP category endpoint and map the
 * editorial sections listed in the provider seeds to their WP counterparts.
 * Update if the site's category taxonomy changes (re-run the curl above).
 */
export const NAUTILUS_WP_CATEGORY_MAP: Record<string, number> = {
  "art-science": 11,
  "biology-beyond": 12,
  "cosmos": 13,
  "culture": 14,
  "earth": 15,
  "life": 16,
  "mind": 17,
  "ocean": 18,
};

/** Per-request page size for the WP REST API (max allowed is 100). */
const PER_PAGE = 20;

/** Safety cap on the number of pages fetched per discovery run. */
const MAX_PAGES = 5;

/**
 * Fetches article URLs from the Nautilus WordPress REST API. Paginates
 * through results until `limit` candidates are collected, the last page is
 * smaller than `PER_PAGE`, or `MAX_PAGES` is reached. Returns an empty array
 * on any fetch/parse failure (graceful degradation).
 */
export async function fetchNautilusUrls(
  limit: number,
  fetchFn: ExtractorFetch,
): Promise<string[]> {
  const urls: string[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    // Fetch enough candidates; stop early once we've gathered 2× the limit
    if (urls.length >= limit * 2) break;

    const apiUrl =
      `${NAUTILUS_WP_API_BASE}` +
      `?per_page=${PER_PAGE}&page=${page}&_embed=false`;

    let body: string;
    try {
      body = await fetchFn(apiUrl);
    } catch (err) {
      log.warn("nautilus.wp_api.fetch_failed", {
        page,
        error: err instanceof Error ? err.message : String(err),
      });
      break;
    }

    let posts: Array<{ link?: unknown }>;
    try {
      const parsed: unknown = JSON.parse(body);
      if (!Array.isArray(parsed)) break;
      posts = parsed as Array<{ link?: unknown }>;
    } catch {
      log.warn("nautilus.wp_api.parse_failed", { page });
      break;
    }

    if (posts.length === 0) break;

    for (const post of posts) {
      if (typeof post.link === "string" && post.link.startsWith("http")) {
        urls.push(post.link);
      }
    }

    // If the page returned fewer items than requested there are no more pages.
    if (posts.length < PER_PAGE) break;
  }

  return urls;
}
