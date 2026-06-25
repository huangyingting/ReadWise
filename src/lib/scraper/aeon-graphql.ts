/**
 * Aeon GraphQL URL extractor.
 *
 * Queries Aeon's GraphQL API for essays, following cursor-based pagination
 * until the requested `limit` is reached, the result set is exhausted, or an
 * error occurs. Non-essay nodes (e.g. videos) are filtered out before the
 * results are returned for further URL-pattern validation.
 *
 * Endpoint: https://aeon.co/api/graphql
 * Schema notes: the `articles` connection on the essays section returns edges
 * with `{ node { url type } cursor }` and a `pageInfo { hasNextPage endCursor }`.
 * Update `AEON_ESSAYS_QUERY` if Aeon's schema drifts.
 */

import type { ExtractorFetch } from "@/lib/scraper/types";
import { createLogger } from "@/lib/observability/logger";

const log = createLogger("scraper.aeon");

/** Aeon's public GraphQL endpoint. */
export const AEON_GRAPHQL_ENDPOINT = "https://aeon.co/api/graphql";

/** Node types that represent written essays we want to ingest. */
const ESSAY_TYPES = new Set(["essay", "Essay", "ESSAY", "article", "Article"]);

/** Per-page fetch size for cursor pagination. */
const PER_PAGE = 20;

/** Safety cap on paginated requests per discovery run. */
const MAX_PAGES = 5;

/**
 * GraphQL query for Aeon essays. Variables: `$first` (Int!), `$after` (String).
 *
 * The `type` field distinguishes essays from videos/other content.
 * `url` is the canonical permalink returned directly from the API.
 */
export const AEON_ESSAYS_QUERY = `
  query ListEssays($first: Int!, $after: String) {
    articles(section: "essays", first: $first, after: $after) {
      edges {
        node {
          url
          type
          slug
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

type AeonNode = { url?: unknown; type?: unknown; slug?: unknown };
type AeonEdge = { node?: AeonNode; cursor?: unknown };
type AeonConnection = {
  edges?: AeonEdge[];
  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
};
type AeonGraphQlResponse = {
  data?: { articles?: AeonConnection };
  errors?: Array<{ message?: string }>;
};

/**
 * Fetches essay URLs from Aeon's GraphQL API with cursor-based pagination.
 * Filters out non-essay nodes. Returns an empty array on any error.
 */
export async function fetchAeonUrls(
  limit: number,
  fetchFn: ExtractorFetch,
): Promise<string[]> {
  const urls: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    if (urls.length >= limit * 2) break;

    const variables: Record<string, unknown> = { first: PER_PAGE };
    if (cursor) variables.after = cursor;

    let body: string;
    try {
      body = await fetchFn(AEON_GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: AEON_ESSAYS_QUERY, variables }),
      });
    } catch (err) {
      log.warn("aeon.graphql.fetch_failed", {
        page,
        error: err instanceof Error ? err.message : String(err),
      });
      break;
    }

    let parsed: AeonGraphQlResponse;
    try {
      parsed = JSON.parse(body) as AeonGraphQlResponse;
    } catch {
      log.warn("aeon.graphql.parse_failed", { page });
      break;
    }

    if (parsed.errors?.length) {
      const msg = parsed.errors.map((e) => e.message ?? "unknown").join("; ");
      log.warn("aeon.graphql.errors", { page, errors: msg });
      break;
    }

    const connection = parsed.data?.articles;
    if (!connection) {
      log.warn("aeon.graphql.unexpected_schema", { page });
      break;
    }

    const edges = connection.edges ?? [];

    for (const edge of edges) {
      const node = edge.node;
      if (!node) continue;

      // Filter out non-essay content (videos, etc.)
      const nodeType = typeof node.type === "string" ? node.type : "";
      if (nodeType && !ESSAY_TYPES.has(nodeType)) continue;

      const url = typeof node.url === "string" ? node.url.trim() : "";
      if (!url.startsWith("http")) continue;

      // Strip fragments
      let normalized: string;
      try {
        const u = new URL(url);
        u.hash = "";
        normalized = u.href;
      } catch {
        continue;
      }

      if (!seen.has(normalized)) {
        seen.add(normalized);
        urls.push(normalized);
      }
    }

    const pageInfo = connection.pageInfo;
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
    cursor = pageInfo.endCursor;
  }

  return urls;
}
