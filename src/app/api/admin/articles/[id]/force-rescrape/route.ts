import { NextResponse } from "next/server";

import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { boolean, idParams, object, optional, string } from "@/lib/validation";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";
import { scraperForceRescrapeEnabled } from "@/lib/runtime-config/scraper";
import { articleHtmlToReaderText } from "@/lib/content-pipeline";
import {
  requestForceRescrape,
  type ForceRescrapeOutcome,
} from "@/lib/scraper/incremental/force-rescrape-runner";
import { createAnnotationMigrator } from "@/lib/scraper/incremental/annotation-migrator";
import { getForceRescrapeStatus } from "@/lib/scraper/incremental/force-rescrape-query";

/**
 * The PRODUCTION annotation re-anchoring migrator (#1103). The Reader derives a
 * highlight's plain-text offsets with `articleHtmlToReaderText`, so the migrator
 * must derive the PROPOSED version's plain text the SAME way for offsets to line
 * up. The app layer (this route) may import `@/lib/content-pipeline`; the scraper
 * migrator takes it as an injected seam to keep the one-way module boundary. Not
 * exported — a `route.ts` may export only HTTP handlers + Next config.
 */
const productionAnnotationMigrator = createAnnotationMigrator({
  deriveReaderText: articleHtmlToReaderText,
});

/**
 * Body for requesting (or previewing) a force-rescrape of ONE known public
 * Article. `reason` is MANDATORY operator justification (durable provenance on
 * the content version + the audit record); `dryRun` returns a metadata-only
 * preview that creates no version and fetches no body.
 */
const forceRescrapeBody = object({
  reason: string({ min: 1, max: 500 }),
  dryRun: optional(boolean()),
});

/** Client-safe message for each ineligible target reason (never leaks internals). */
const INELIGIBLE_MESSAGE: Record<string, string> = {
  "not-found": "Article not found",
  "not-public": "Only a public library article can be force-rescraped",
  "missing-source-url": "Article has no source URL to refetch",
  "taken-down": "A taken-down or unpublished article cannot be force-rescraped",
};

/** Turns a force-rescrape outcome into the HTTP response (metadata only). */
function forceRescrapeResponse(outcome: ForceRescrapeOutcome): NextResponse {
  if (!outcome.ok) {
    if (outcome.kind === "conflict") {
      return NextResponse.json(
        {
          error: "A force-rescrape is already in progress for this article",
          reason: "conflict",
          concurrent: true,
        },
        { status: 409 },
      );
    }
    const status = outcome.reason === "not-found" ? 404 : 409;
    return NextResponse.json(
      { error: INELIGIBLE_MESSAGE[outcome.reason] ?? "Article cannot be force-rescraped", reason: outcome.reason },
      { status },
    );
  }

  if (outcome.kind === "dry-run") {
    return NextResponse.json({ ok: true, dryRun: true, preview: outcome.preview });
  }
  if (outcome.kind === "activated") {
    return NextResponse.json({
      ok: true,
      dryRun: false,
      outcome: "activated",
      articleId: outcome.articleId,
      versionId: outcome.versionId,
      supersededVersionId: outcome.supersededVersionId,
    });
  }
  // Controlled failure: the old active version + all reader access are retained.
  return NextResponse.json({
    ok: true,
    dryRun: false,
    outcome: "failed",
    articleId: outcome.articleId,
    versionId: outcome.versionId,
    reason: outcome.reason,
  });
}

/**
 * The DEDICATED high-permission entry point to refresh ONE known public Article
 * (issue #1102). This is the ONLY sanctioned path to refresh a known Article and
 * is unreachable from scheduled/normal discovery (the normal scrape trigger still
 * rejects `force-rescrape`). Gated on `sources.manage`; the wrapper enforces
 * deny-by-default (401/403) and CSRF. A `reason` is mandatory. With
 * `dryRun: true` it returns a metadata-only preview that creates no content
 * version and fetches no body. A real request fetches + validates a replacement
 * into a PENDING version and only ATOMICALLY activates it (preserving the Article
 * id, owner, visibility, and reading relationships) after every gate passes;
 * otherwise it records a controlled failure and RETAINS the current version.
 *
 * `SCRAPER_FORCE_RESCRAPE=false` hard-disables this endpoint (503) before any
 * read/write — a kill-switch independent of RBAC. Only a real state-changing
 * outcome (activated / controlled-failure) writes a sanitized audit entry (actor,
 * reason, version ids, failure code — never a URL or article content).
 */
export const POST = createCapabilityHandler(
  CAPABILITIES.sourcesManage,
  { params: idParams, body: forceRescrapeBody },
  async ({ req, params, body, session, requestId }) => {
    if (!scraperForceRescrapeEnabled()) {
      return NextResponse.json(
        { error: "Force-rescrape is disabled", reason: "disabled" },
        { status: 503 },
      );
    }

    const outcome = await requestForceRescrape(
      {
        articleId: params.id,
        reason: body.reason,
        requestedById: session?.user?.id ?? null,
        dryRun: body.dryRun ?? false,
      },
      { annotationMigrator: productionAnnotationMigrator },
    );

    if (outcome.ok && outcome.kind === "activated") {
      await recordAuditFromRequest({
        req,
        session,
        requestId,
        action: AUDIT_ACTIONS.adminForceRescrapeActivate,
        targetType: "article",
        targetId: outcome.articleId,
        metadata: {
          reason: body.reason,
          versionId: outcome.versionId,
          ...(outcome.supersededVersionId ? { supersededVersionId: outcome.supersededVersionId } : {}),
          outcome: "activated",
        },
      });
    } else if (outcome.ok && outcome.kind === "failed") {
      await recordAuditFromRequest({
        req,
        session,
        requestId,
        action: AUDIT_ACTIONS.adminForceRescrapeFail,
        targetType: "article",
        targetId: outcome.articleId,
        metadata: {
          reason: body.reason,
          versionId: outcome.versionId,
          failureReason: outcome.reason,
          outcome: "failed",
        },
      });
    }

    return forceRescrapeResponse(outcome);
  },
);

/**
 * Returns ONE Article's sanitized force-rescrape status: its ACTIVE + PENDING
 * content versions, a bounded newest-first version history, and the reader-
 * annotation count that gates activation — all metadata only (no content, title,
 * or URL). Gated on `sources.manage`; deny-by-default (401/403) enforced by the
 * wrapper.
 */
export const GET = createCapabilityHandler(
  CAPABILITIES.sourcesManage,
  { params: idParams },
  async ({ params }) => {
    const status = await getForceRescrapeStatus(params.id);
    if (!status) return NextResponse.json({ error: "Article not found" }, { status: 404 });
    return NextResponse.json({ status });
  },
);
