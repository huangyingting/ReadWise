import { NextResponse } from "next/server";

import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { queryInt, queryString } from "@/lib/validation";
import {
  REVIEW_QUEUE_STATUSES,
  listReviewCandidates,
  type ReviewQueueStatus,
} from "@/lib/scraper/incremental/candidate-review-query";

const REVIEW_STATUS_SET = new Set<string>(REVIEW_QUEUE_STATUSES);

function parseStatus(params: URLSearchParams): ReviewQueueStatus | undefined {
  const raw = queryString(params, "status").trim();
  return REVIEW_STATUS_SET.has(raw) ? (raw as ReviewQueueStatus) : undefined;
}

function reviewCandidatesQuery(params: URLSearchParams) {
  const providerKey = queryString(params, "providerKey").trim().slice(0, 200);
  const discoverySourceId = queryString(params, "discoverySourceId").trim().slice(0, 200);
  return {
    ok: true as const,
    value: {
      status: parseStatus(params),
      providerKey: providerKey || undefined,
      discoverySourceId: discoverySourceId || undefined,
      offset: queryInt(params, "offset", { fallback: 0, min: 0 }),
      limit: queryInt(params, "limit", { fallback: 50, min: 1, max: 200 }),
    },
  };
}

/**
 * Lists crawl candidates awaiting (or resolved from) operator review (#1100).
 * Gated on `sources.manage`; deny-by-default (401/403) is enforced by the
 * capability wrapper. The `status` filter defaults to NEEDS_REVIEW and accepts
 * SKIPPED_REVIEW (rejected — visible so an operator can reactivate one); provider
 * and source filters plus offset/limit pagination bound the result. Every field
 * is a sanitized id, versioned identity HASH, status, count, timestamp, or reason
 * CATEGORY — never a URL, body, secret, or article content.
 */
export const GET = createCapabilityHandler(
  CAPABILITIES.sourcesManage,
  { query: reviewCandidatesQuery },
  async ({ query }) => {
    const page = await listReviewCandidates({
      status: query.status,
      providerKey: query.providerKey,
      discoverySourceId: query.discoverySourceId,
      offset: query.offset,
      limit: query.limit,
    });
    return NextResponse.json(page);
  },
);
