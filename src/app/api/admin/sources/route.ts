import { NextResponse } from "next/server";
import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { listContentSources, summarizeSourceHealth } from "@/lib/scraper/sources";

/**
 * Lists content sources with their operational health (RW-046/RW-050). Gated on
 * `sources.manage`.
 */
export const GET = createCapabilityHandler(CAPABILITIES.sourcesManage, {}, async () => {
  const sources = await listContentSources();
  return NextResponse.json({
    sources: sources.map((source) => ({
      ...source,
      health: summarizeSourceHealth(source),
    })),
  });
});
