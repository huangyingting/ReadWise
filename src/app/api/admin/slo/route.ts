import { NextResponse } from "next/server";
import { createAdminHandler } from "@/lib/api-handler";
import { evaluateSlos, SLI_CATALOG } from "@/lib/slo";

/**
 * Admin-gated SLO status (RW-034). Returns the SLI catalog + the current
 * evaluation of every indicator (status/value/objective) computed from the live
 * in-process metrics, ready for a dashboard or breach review. No-store: the
 * snapshot is point-in-time.
 */
export const GET = createAdminHandler({}, () => {
  const report = evaluateSlos();
  return NextResponse.json(
    { catalog: SLI_CATALOG, report },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
});
