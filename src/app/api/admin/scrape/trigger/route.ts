export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createAdminHandler, ApiError } from "@/lib/api-handler";
import { object, optional, nonEmptyString, number, boolean } from "@/lib/validation";
import { PROVIDERS, getProvider } from "@/lib/scraper/providers";
import { discoverProviderUrls } from "@/lib/scraper/discovery";
import { scrapeUrl, saveDraftArticle } from "@/lib/scraper";
import { revalidateArticlesCache } from "@/lib/cache";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";
import { recordSecurityEvent, SECURITY_EVENT_TYPES } from "@/lib/security/events";
import { clientIp } from "@/lib/security/client-ip";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 50;

const triggerBody = object({
  /** Provider key to scrape. */
  provider: optional(nonEmptyString(100)),
  /** Set to true to scrape all registered providers. */
  all: optional(boolean()),
  /** Max articles to discover per provider (default: 5, max: 50). */
  limit: optional(number({ int: true, min: 1, max: MAX_LIMIT })),
});

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
export const POST = createAdminHandler(
  { body: triggerBody },
  async ({ req, body, session, requestId, log }) => {
    const limit = body.limit ?? DEFAULT_LIMIT;
    const scrapeAll = body.all === true;

    let providers;
    if (scrapeAll) {
      providers = [...PROVIDERS];
    } else if (body.provider) {
      const p = getProvider(body.provider);
      if (!p) {
        throw new ApiError(
          400,
          `Unknown provider: "${body.provider}". Available: ${PROVIDERS.map((p) => p.key).join(", ")}.`,
        );
      }
      providers = [p];
    } else {
      throw new ApiError(400, "Specify a `provider` key or set `all: true`.");
    }

    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.adminScrapeTrigger,
      targetType: "scrape",
      targetId: scrapeAll ? "all" : providers[0]?.key ?? "unknown",
      metadata: {
        providerCount: providers.length,
        providers: providers.map((p) => p.key),
        limit,
        phase: "requested",
      },
    });

    type ProviderResult = {
      provider: string;
      discovered: number;
      saved: number;
      skipped: number;
      failed: number;
      error?: string;
    };
    const results: ProviderResult[] = [];

    for (const provider of providers) {
      let urls: string[] = [];
      try {
        urls = await discoverProviderUrls(provider, limit);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn("scrape.trigger.discover_failed", { provider: provider.key, error: message });
        recordSecurityEvent({
          type: SECURITY_EVENT_TYPES.importFailed,
          severity: "medium",
          route: "/api/admin/scrape/trigger",
          actorId: session.user.id,
          ip: clientIp(req),
          meta: { provider: provider.key, phase: "discover", error: message },
        });
        results.push({ provider: provider.key, discovered: 0, saved: 0, skipped: 0, failed: 0, error: message });
        continue;
      }

      let saved = 0, skipped = 0, failed = 0;
      for (const url of urls) {
        try {
          const article = await scrapeUrl(url);
          const outcome = article
            ? await saveDraftArticle(article, (created) => ({
                req,
                session,
                requestId,
                action: AUDIT_ACTIONS.adminArticleIngest,
                targetType: "article",
                targetId: created.id,
                metadata: { source: "scrape.trigger", provider: provider.key },
              }))
            : { status: "failed" as const, reason: "could not extract article content", sourceUrl: url };
          if (outcome.status === "saved") saved++;
          else if (outcome.status === "skipped") skipped++;
          else failed++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.warn("scrape.trigger.save_failed", { provider: provider.key, url, error: message });
          recordSecurityEvent({
            type: SECURITY_EVENT_TYPES.importFailed,
            severity: "medium",
            route: "/api/admin/scrape/trigger",
            actorId: session.user.id,
            ip: clientIp(req),
            meta: { provider: provider.key, phase: "save", error: message },
          });
          failed++;
        }
      }

      log.info("scrape.trigger.provider_done", {
        provider: provider.key,
        discovered: urls.length,
        saved,
        skipped,
        failed,
      });
      results.push({ provider: provider.key, discovered: urls.length, saved, skipped, failed });
    }

    const totalSaved = results.reduce((s, r) => s + r.saved, 0);
    if (totalSaved > 0) {
      revalidateArticlesCache();
    }

    return NextResponse.json({
      ok: true,
      results,
      totalSaved,
      note:
        totalSaved > 0
          ? "Drafts saved. The background worker will process them automatically."
          : "No new articles saved.",
    });
  },
);
