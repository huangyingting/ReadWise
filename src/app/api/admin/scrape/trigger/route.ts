export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createCapabilityHandler, ApiError } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { object, optional, nonEmptyString, number, boolean, oneOf } from "@/lib/validation";
import {
  ADMIN_SCRAPE_TRIGGER_MAX_LIMIT,
  AdminScrapeTriggerInputError,
  AdminScrapeTriggerModeError,
  runAdminScrapeTrigger,
} from "@/lib/scraper/admin-trigger";
import { TRIGGER_MODES, type TriggerMode } from "@/lib/scraper/incremental/trigger-mode";

const triggerBody = object({
  /** Provider key to request an incremental run for. */
  provider: optional(nonEmptyString(100)),
  /** Set to true to request a run for all registered providers. */
  all: optional(boolean()),
  /** Advisory bound recorded on the trigger (default: 5, max: 50). */
  limit: optional(number({ int: true, min: 1, max: ADMIN_SCRAPE_TRIGGER_MAX_LIMIT })),
  /**
   * Trigger mode. Only `incremental` (the default) is implemented; `backfill`
   * and `force-rescrape` are accepted by the schema so the handler can reject
   * them EXPLICITLY (Phase 3) rather than falling through. Unknown keys are
   * dropped, so a bypass/force flag cannot be smuggled.
   */
  mode: optional(oneOf<TriggerMode>(TRIGGER_MODES)),
});

function scrapeTriggerNote(totalSourcesRequested: number): string {
  return totalSourcesRequested > 0
    ? "Incremental discovery requested. The worker will run the source(s) and enqueue candidate ingest for new identities only."
    : "No claimable discovery sources matched; nothing was requested.";
}

async function runTrigger(
  body: Parameters<typeof runAdminScrapeTrigger>[0],
  context: Parameters<typeof runAdminScrapeTrigger>[1],
) {
  try {
    return await runAdminScrapeTrigger(body, context);
  } catch (err) {
    if (err instanceof AdminScrapeTriggerInputError || err instanceof AdminScrapeTriggerModeError) {
      throw new ApiError(400, err.message);
    }
    throw err;
  }
}

/**
 * POST /api/admin/scrape/trigger
 *
 * Admin-only. REQUESTS an incremental discovery run for one or all providers by
 * making their claimable-mode discovery sources due; the background worker runs
 * bounded, ledger-based discovery and enqueues candidate ingest for genuinely
 * new identities only. It NEVER synchronously fetches or rescrapes URLs, so a
 * known public Article can never be automatically re-ingested by this route.
 *
 * Body: { provider?: string, all?: boolean, limit?: number, mode?: "incremental" }
 * Returns per-provider sourcesRequested + total. `backfill`/`force-rescrape`
 * fail with 400 (not implemented until Phase 3).
 */
export const POST = createCapabilityHandler(
  CAPABILITIES.sourcesManage,
  { body: triggerBody },
  async ({ req, body, session, requestId, log }) => {
    const triggerResult = await runTrigger(body, { req, session, requestId, log });
    const { mode, results, totalSourcesRequested } = triggerResult;

    return NextResponse.json({
      ok: true,
      mode,
      results,
      totalSourcesRequested,
      note: scrapeTriggerNote(totalSourcesRequested),
    });
  },
);
