import { NextResponse } from "next/server";

import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { queryInt, queryString } from "@/lib/validation";
import { DiscoverySourceLifecycleMode } from "@prisma/client";
import { listDiscoverySourceMetrics } from "@/lib/scraper/incremental/observability-query";

type DiscoverySourcesQuery = {
  providerKey?: string;
  lifecycleMode?: DiscoverySourceLifecycleMode;
  limit: number;
};

const LIFECYCLE_MODES = new Set<string>(Object.values(DiscoverySourceLifecycleMode));

function parseMode(params: URLSearchParams): DiscoverySourceLifecycleMode | undefined {
  const raw = queryString(params, "lifecycleMode").trim();
  return LIFECYCLE_MODES.has(raw) ? (raw as DiscoverySourceLifecycleMode) : undefined;
}

function discoverySourcesQuery(params: URLSearchParams) {
  const providerKey = queryString(params, "providerKey").trim().slice(0, 200);
  return {
    ok: true as const,
    value: {
      providerKey: providerKey || undefined,
      lifecycleMode: parseMode(params),
      limit: queryInt(params, "limit", { fallback: 200, min: 1, max: 500 }),
    } satisfies DiscoverySourcesQuery,
  };
}

/**
 * Lists discovery sources with their computed observability metric summaries
 * (#1089). Gated on `sources.manage`; deny-by-default (401/403) is enforced by
 * the capability wrapper. Every field is a controlled id/count/status/duration —
 * no URL, article content, or secret is exposed.
 */
export const GET = createCapabilityHandler(
  CAPABILITIES.sourcesManage,
  { query: discoverySourcesQuery },
  async ({ query }) => {
    const sources = await listDiscoverySourceMetrics({
      providerKey: query.providerKey,
      lifecycleMode: query.lifecycleMode,
      limit: query.limit,
    });
    return NextResponse.json({ sources });
  },
);
