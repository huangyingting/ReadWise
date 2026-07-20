import { NextResponse } from "next/server";

import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { queryInt, queryString } from "@/lib/validation";
import { listDeletedCandidates } from "@/lib/scraper/incremental/deleted-article-recovery";

function deletedQuery(params: URLSearchParams) {
  const providerKey = queryString(params, "providerKey").trim().slice(0, 200);
  return {
    ok: true as const,
    value: {
      providerKey: providerKey || undefined,
      offset: queryInt(params, "offset", { fallback: 0, min: 0 }),
      limit: queryInt(params, "limit", { fallback: 50, min: 1, max: 200 }),
    },
  };
}

/**
 * Lists deleted identities eligible for explicit operator recovery (#1104, AC2):
 * CrawlCandidates that produced a now-deleted Article (a stamped `articleDeletedAt`
 * and no live Article). Gated on `sources.manage`; the wrapper enforces
 * deny-by-default (401/403) and CSRF. Optional provider filter + offset/limit
 * pagination, most-recently-deleted first. Every field is a sanitized id,
 * versioned identity HASH, status, timestamp, or reason CATEGORY — never a URL,
 * body, secret, or article content (the content is permanently gone).
 */
export const GET = createCapabilityHandler(
  CAPABILITIES.sourcesManage,
  { query: deletedQuery },
  async ({ query }) => {
    const page = await listDeletedCandidates({
      providerKey: query.providerKey,
      offset: query.offset,
      limit: query.limit,
    });
    return NextResponse.json(page);
  },
);
