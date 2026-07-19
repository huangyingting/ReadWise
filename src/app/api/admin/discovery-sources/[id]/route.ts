import { NextResponse } from "next/server";

import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { idParams } from "@/lib/validation";
import { getDiscoverySourceMetrics } from "@/lib/scraper/incremental/observability-query";

/**
 * Returns the full observability metric summary for ONE discovery source
 * (#1089): operational status, drift signals, candidate rollups, delay
 * percentiles, and volume anomaly. Gated on `sources.manage`; the `id` param is
 * validated (never trusted raw). No URL/content/secret is exposed. Returns 404
 * when the source does not exist.
 */
export const GET = createCapabilityHandler(
  CAPABILITIES.sourcesManage,
  { params: idParams },
  async ({ params }) => {
    const source = await getDiscoverySourceMetrics(params.id);
    if (!source) {
      return NextResponse.json({ error: "Discovery source not found" }, { status: 404 });
    }
    return NextResponse.json({ source });
  },
);
