export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createCapabilityHandler, ApiError } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { object, optional, nonEmptyString, number, boolean } from "@/lib/validation";
import {
  ADMIN_SCRAPE_TRIGGER_MAX_LIMIT,
  AdminScrapeTriggerInputError,
  runAdminScrapeTrigger,
} from "@/lib/scraper/admin-trigger";

const triggerBody = object({
  /** Provider key to scrape. */
  provider: optional(nonEmptyString(100)),
  /** Set to true to scrape all registered providers. */
  all: optional(boolean()),
  /** Max articles to discover per provider (default: 5, max: 50). */
  limit: optional(number({ int: true, min: 1, max: ADMIN_SCRAPE_TRIGGER_MAX_LIMIT })),
});

function scrapeTriggerNote(totalSaved: number): string {
  return totalSaved > 0
    ? "Drafts saved. The background worker will process them automatically."
    : "No new articles saved.";
}

async function runTrigger(
  body: Parameters<typeof runAdminScrapeTrigger>[0],
  context: Parameters<typeof runAdminScrapeTrigger>[1],
) {
  try {
    return await runAdminScrapeTrigger(body, context);
  } catch (err) {
    if (err instanceof AdminScrapeTriggerInputError) {
      throw new ApiError(400, err.message);
    }
    throw err;
  }
}

/**
 * POST /api/admin/scrape/trigger
 *
 * Admin-only. Discovers and saves new draft articles from one or all providers.
 * The background worker picks up the drafts automatically for AI enrichment.
 *
 * Body: { provider?: string, all?: boolean, limit?: number }
 * Returns a summary: discovered / saved / skipped / failed per provider.
 *
 * Graceful: network failures per provider are caught individually.
 */
export const POST = createCapabilityHandler(
  CAPABILITIES.sourcesManage,
  { body: triggerBody },
  async ({ req, body, session, requestId, log }) => {
    const triggerResult = await runTrigger(body, { req, session, requestId, log });
    const { results, totalSaved } = triggerResult;

    return NextResponse.json({
      ok: true,
      results,
      totalSaved,
      note: scrapeTriggerNote(totalSaved),
    });
  },
);
