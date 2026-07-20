import { NextResponse } from "next/server";

import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { queryInt, queryString } from "@/lib/validation";
import { CanonicalConflictStatus } from "@prisma/client";
import { listCanonicalConflicts } from "@/lib/scraper/incremental/canonical-conflict-query";

const STATUS_SET = new Set<string>(Object.values(CanonicalConflictStatus));

function parseStatus(params: URLSearchParams): CanonicalConflictStatus | undefined {
  const raw = queryString(params, "status").trim();
  return STATUS_SET.has(raw) ? (raw as CanonicalConflictStatus) : undefined;
}

function conflictQuery(params: URLSearchParams) {
  const providerKey = queryString(params, "providerKey").trim().slice(0, 200);
  return {
    ok: true as const,
    value: {
      status: parseStatus(params),
      providerKey: providerKey || undefined,
      offset: queryInt(params, "offset", { fallback: 0, min: 0 }),
      limit: queryInt(params, "limit", { fallback: 50, min: 1, max: 200 }),
    },
  };
}

/**
 * Lists canonical-identity conflicts for operator resolution (#1104, AC1). Gated
 * on `sources.manage`; the capability wrapper enforces deny-by-default (401/403)
 * and CSRF. The `status` filter defaults to OPEN and accepts RESOLVED/DISMISSED
 * (so an operator can inspect history); an optional provider filter plus
 * offset/limit pagination bound the result. Every field is a sanitized id,
 * versioned identity HASH, status, dependent-data COUNT, timestamp, or reason
 * CATEGORY — never a URL, body, secret, or article content.
 */
export const GET = createCapabilityHandler(
  CAPABILITIES.sourcesManage,
  { query: conflictQuery },
  async ({ query }) => {
    const page = await listCanonicalConflicts({
      status: query.status,
      providerKey: query.providerKey,
      offset: query.offset,
      limit: query.limit,
    });
    return NextResponse.json(page);
  },
);
