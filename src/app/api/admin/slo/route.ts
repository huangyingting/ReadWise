import { NextResponse } from "next/server";
import { createAdminHandler } from "@/lib/api-handler";
import { evaluateSlos, SLI_CATALOG } from "@/lib/observability/slo";

const NO_STORE_JSON = { status: 200, headers: { "cache-control": "no-store" } };

function sloStatusResponse() {
  return NextResponse.json(
    { catalog: SLI_CATALOG, report: evaluateSlos() },
    NO_STORE_JSON,
  );
}

/**
 * Admin-gated SLO status (RW-034). Returns the SLI catalog + the current
 * evaluation of every indicator (status/value/objective) computed from the live
 * in-process metrics, ready for a dashboard or breach review. No-store: the
 * snapshot is point-in-time.
 */
export const GET = createAdminHandler({}, () => {
  return sloStatusResponse();
});
