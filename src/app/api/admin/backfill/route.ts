import { NextResponse } from "next/server";

import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { boolean, number, object, optional, queryInt, queryString, string } from "@/lib/validation";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";
import {
  scraperBackfillMaxItemsCeiling,
  scraperBackfillMaxWindowDays,
} from "@/lib/runtime-config/scraper";
import { resolveEffectiveBackfillBounds } from "@/lib/scraper/incremental/backfill-policy";
import {
  BACKFILL_RUN_STATUSES,
  getBackfillRun,
  listBackfillRuns,
  previewBackfill,
  type BackfillRunStatusFilter,
} from "@/lib/scraper/incremental/backfill-query";
import { createBackfillRun } from "@/lib/scraper/incremental/backfill-commit";

/**
 * Body for creating (or previewing) a bounded historical backfill. `reason` is
 * MANDATORY (audit provenance), `maxItems` is a positive integer (clamped to the
 * configured ceiling by the policy), and the window edges are OPTIONAL ISO
 * date-times (open edges are bounded by the policy). `dryRun` returns counts only
 * and creates no run / no Job / fetches no body.
 */
const createBody = object({
  providerKey: string({ min: 1, max: 200 }),
  discoverySourceId: optional(string({ min: 1, max: 200 })),
  reason: string({ min: 1, max: 500 }),
  windowStart: optional(string({ min: 1, max: 40 })),
  windowEnd: optional(string({ min: 1, max: 40 })),
  maxItems: number({ int: true, min: 1, max: 1_000_000 }),
  dryRun: optional(boolean()),
});

const BACKFILL_STATUS_SET = new Set<string>(BACKFILL_RUN_STATUSES);

function parseStatusFilter(params: URLSearchParams): BackfillRunStatusFilter | undefined {
  const raw = queryString(params, "status").trim();
  return BACKFILL_STATUS_SET.has(raw) ? (raw as BackfillRunStatusFilter) : undefined;
}

function backfillListQuery(params: URLSearchParams) {
  const providerKey = queryString(params, "providerKey").trim().slice(0, 200);
  return {
    ok: true as const,
    value: {
      status: parseStatusFilter(params),
      providerKey: providerKey || undefined,
      offset: queryInt(params, "offset", { fallback: 0, min: 0 }),
      limit: queryInt(params, "limit", { fallback: 50, min: 1, max: 200 }),
    },
  };
}

/** Client-safe message for each bounds rejection reason (never leaks internals). */
const BOUNDS_ERROR_MESSAGE: Record<string, string> = {
  "invalid-max-items": "maxItems must be a positive integer",
  "invalid-window-order": "windowStart must be on or before windowEnd",
  "invalid-window-start": "windowStart is not a valid date",
  "invalid-window-end": "windowEnd is not a valid date",
};

/** Parses an optional ISO date string; returns undefined on absence, null on malformed. */
function parseOptionalDate(raw: string | undefined): Date | null | undefined {
  if (raw === undefined) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Creates a bounded, low-priority historical backfill run — or, with
 * `dryRun: true`, returns a metadata-only PREVIEW that creates no run, no Job,
 * and fetches no article body (AC). This is the DEDICATED high-permission entry
 * point for backfill; the normal scrape trigger still rejects `backfill`. Gated
 * on `sources.manage`; the wrapper enforces deny-by-default (401/403) and CSRF.
 * A `reason` is mandatory. Bounds are clamped to the configured ceilings by the
 * pure policy, and only a real (non-dry-run) creation writes a sanitized audit
 * entry (actor, reason, requested vs effective bounds, warnings — never a URL or
 * content).
 */
export const POST = createCapabilityHandler(
  CAPABILITIES.sourcesManage,
  { body: createBody },
  async ({ req, body, session, requestId }) => {
    const windowStart = parseOptionalDate(body.windowStart);
    if (windowStart === null) {
      return NextResponse.json({ error: BOUNDS_ERROR_MESSAGE["invalid-window-start"] }, { status: 400 });
    }
    const windowEnd = parseOptionalDate(body.windowEnd);
    if (windowEnd === null) {
      return NextResponse.json({ error: BOUNDS_ERROR_MESSAGE["invalid-window-end"] }, { status: 400 });
    }

    const requested = {
      windowStart: windowStart ?? null,
      windowEnd: windowEnd ?? null,
      maxItems: body.maxItems,
    };
    const resolved = resolveEffectiveBackfillBounds(
      requested,
      {
        maxItemsCeiling: scraperBackfillMaxItemsCeiling(),
        maxWindowDays: scraperBackfillMaxWindowDays(),
      },
      new Date(),
    );
    if (!resolved.ok) {
      return NextResponse.json(
        { error: BOUNDS_ERROR_MESSAGE[resolved.reason] ?? "Invalid backfill bounds", reason: resolved.reason },
        { status: 400 },
      );
    }

    const scope = { providerKey: body.providerKey, discoverySourceId: body.discoverySourceId ?? null };

    if (body.dryRun) {
      const preview = await previewBackfill(scope, resolved.effective);
      return NextResponse.json({
        ok: true,
        dryRun: true,
        effective: resolved.effective,
        warnings: resolved.warnings,
        preview,
      });
    }

    const created = await createBackfillRun({
      providerKey: body.providerKey,
      discoverySourceId: body.discoverySourceId ?? null,
      actorId: session?.user?.id ?? null,
      reason: body.reason,
      requested,
      effective: resolved.effective,
      warnings: resolved.warnings,
    });

    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.adminBackfillCreate,
      targetType: "backfill_run",
      targetId: created.id,
      metadata: {
        providerKey: body.providerKey,
        ...(body.discoverySourceId ? { discoverySourceId: body.discoverySourceId } : {}),
        reason: body.reason,
        requestedMaxItems: body.maxItems,
        effectiveMaxItems: resolved.effective.maxItems,
        effectiveWindowStart: resolved.effective.windowStart.toISOString(),
        effectiveWindowEnd: resolved.effective.windowEnd.toISOString(),
        warnings: resolved.warnings,
      },
    });

    const run = await getBackfillRun(created.id);
    return NextResponse.json({ ok: true, dryRun: false, run }, { status: 201 });
  },
);

/**
 * Lists historical backfill runs (newest first) with optional status/provider
 * filters and offset/limit pagination. Gated on `sources.manage`;
 * deny-by-default (401/403) is enforced by the wrapper. Every field is a
 * sanitized id, status, count, timestamp, bounds value, or reason category —
 * never a URL, body, secret, or article content.
 */
export const GET = createCapabilityHandler(
  CAPABILITIES.sourcesManage,
  { query: backfillListQuery },
  async ({ query }) => {
    const page = await listBackfillRuns({
      status: query.status,
      providerKey: query.providerKey,
      offset: query.offset,
      limit: query.limit,
    });
    return NextResponse.json(page);
  },
);
