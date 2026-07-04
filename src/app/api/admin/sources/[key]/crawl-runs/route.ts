import { NextResponse } from "next/server";
import { createCapabilityHandler, ApiError } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { object, nonEmptyString, queryInt } from "@/lib/validation";
import {
  CRAWL_RUN_HISTORY_LIMIT,
  CRAWL_RUN_HISTORY_API_MAX_LIMIT,
  getContentSource,
  listRecentCrawlRuns,
} from "@/lib/scraper/sources";

const keyParams = object({ key: nonEmptyString(200) });

type CrawlRunQuery = { limit: number };

function crawlRunQuery(params: URLSearchParams): { ok: true; value: CrawlRunQuery } {
  return {
    ok: true,
    value: {
      limit: queryInt(params, "limit", {
        fallback: CRAWL_RUN_HISTORY_LIMIT,
        min: 1,
        max: CRAWL_RUN_HISTORY_API_MAX_LIMIT,
      }),
    },
  };
}

/**
 * GET /api/admin/sources/[key]/crawl-runs
 *
 * Capability-gated operational endpoint for privacy-safe provider drift triage.
 * Returns recent crawl-run summaries only: no URLs, article text, prompts,
 * selected text, definitions, translations, or user-private content.
 */
export const GET = createCapabilityHandler(
  CAPABILITIES.sourcesManage,
  { params: keyParams, query: crawlRunQuery },
  async ({ params, query }) => {
    const source = await getContentSource(params.key);
    if (!source) throw new ApiError(404, "Content source not found");

    const runs = await listRecentCrawlRuns(params.key, query.limit);
    const res = NextResponse.json({ ok: true, providerKey: params.key, runs });
    res.headers.set("cache-control", "no-store");
    return res;
  },
);
