import { NextResponse } from "next/server";

import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { idParams, object, oneOf, optional, string } from "@/lib/validation";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";
import {
  BACKFILL_CONTROL_ACTIONS,
  type BackfillControlAction,
} from "@/lib/scraper/incremental/backfill-policy";
import {
  applyBackfillControl,
  type BackfillControlOutcome,
} from "@/lib/scraper/incremental/backfill-commit";
import { getBackfillRun } from "@/lib/scraper/incremental/backfill-query";

const controlBody = object({
  action: oneOf<BackfillControlAction>(BACKFILL_CONTROL_ACTIONS),
  reason: optional(string({ min: 1, max: 500 })),
});

/** Client-safe message for each illegal-transition reason. */
const ILLEGAL_MESSAGE: Record<string, string> = {
  "not-active": "Only a running backfill can be paused",
  "not-paused": "Only a paused backfill can be resumed",
  "already-terminal": "Backfill has already finished and cannot be changed",
};

/** Turns a control outcome into the HTTP response (mirrors the candidate-review route). */
function controlOutcomeResponse(outcome: BackfillControlOutcome): NextResponse {
  if (outcome.ok) {
    return NextResponse.json(
      outcome.kind === "applied"
        ? { ok: true, outcome: "applied", action: outcome.action, fromStatus: outcome.fromStatus, toStatus: outcome.toStatus }
        : { ok: true, outcome: "noop", action: outcome.action, reason: outcome.reason, status: outcome.status },
    );
  }
  if (outcome.reason === "not-found") {
    return NextResponse.json({ error: "Backfill run not found" }, { status: 404 });
  }
  if (outcome.reason === "stale") {
    return NextResponse.json(
      { error: "Backfill run changed concurrently; refresh and retry", reason: "stale", stale: true, status: outcome.status },
      { status: 409 },
    );
  }
  return NextResponse.json(
    { error: ILLEGAL_MESSAGE[outcome.illegal] ?? "Control action not allowed", reason: "illegal", detail: outcome.illegal, status: outcome.status },
    { status: 409 },
  );
}

/**
 * Returns ONE backfill run's sanitized status/progress (metadata only). Gated on
 * `sources.manage`; deny-by-default (401/403) enforced by the wrapper.
 */
export const GET = createCapabilityHandler(
  CAPABILITIES.sourcesManage,
  { params: idParams },
  async ({ params }) => {
    const run = await getBackfillRun(params.id);
    if (!run) return NextResponse.json({ error: "Backfill run not found" }, { status: 404 });
    return NextResponse.json({ run });
  },
);

/**
 * Applies ONE lifecycle control (pause | resume | cancel) to a backfill run. This
 * NEVER widens the administrator-approved range (it touches only status +
 * timestamps); pause/resume/cancel are idempotent (a repeat is a no-op). Gated on
 * `sources.manage`; the wrapper enforces deny-by-default (401/403) and CSRF. Only
 * a state-CHANGING outcome writes a sanitized audit entry (ids, from/to status,
 * reason category — never a URL/content/secret).
 */
export const POST = createCapabilityHandler(
  CAPABILITIES.sourcesManage,
  { params: idParams, body: controlBody },
  async ({ req, params, body, session, requestId }) => {
    const outcome = await applyBackfillControl({ runId: params.id, action: body.action });

    if (outcome.ok && outcome.kind === "applied") {
      await recordAuditFromRequest({
        req,
        session,
        requestId,
        action: AUDIT_ACTIONS.adminBackfillControl,
        targetType: "backfill_run",
        targetId: params.id,
        metadata: {
          action: outcome.action,
          fromStatus: outcome.fromStatus,
          toStatus: outcome.toStatus,
          ...(body.reason ? { reason: body.reason } : {}),
        },
      });
    }

    return controlOutcomeResponse(outcome);
  },
);
