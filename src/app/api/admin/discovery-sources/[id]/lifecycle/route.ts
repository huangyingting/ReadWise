import { NextResponse } from "next/server";

import { ApiError, createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { idParams, object, oneOf } from "@/lib/validation";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";
import {
  LIFECYCLE_ACTIONS,
  applyLifecycleAction,
  type LifecycleActionFailure,
  type LifecycleActionName,
} from "@/lib/scraper/incremental/lifecycle-actions";

const actionBody = object({ action: oneOf<LifecycleActionName>(LIFECYCLE_ACTIONS) });

/** Maps a typed action failure to a client-safe HTTP status + message. */
const FAILURE_RESPONSE: Record<LifecycleActionFailure, { status: number; message: string }> = {
  "source-not-found": { status: 404, message: "Discovery source not found" },
  busy: { status: 409, message: "Source is currently being processed by a worker" },
  "invalid-transition": { status: 409, message: "Lifecycle transition not allowed from the current mode" },
  "lease-lost": { status: 409, message: "Source changed concurrently; retry" },
  "baseline-incomplete": { status: 409, message: "Baseline is not complete" },
  "exit-gates-failed": { status: 409, message: "Phase 1 exit gates are not all passing; source remains shadowed" },
  "auth-identity-ineligible": {
    status: 409,
    message: "Authenticated source needs a stable, secret-free identity and credential reference before activation",
  },
};

/**
 * Applies a validated, capability-gated, audited lifecycle action to a discovery
 * source (#1089). Actions: begin-baseline | activate | pause | resume | rollback
 * | disable | retire. Gated on `sources.manage`; the wrapper enforces
 * deny-by-default (401/403), CSRF, and records the mutation as a security event.
 * The action + id are validated (never trusted raw), and every successful
 * mutation writes a sanitized audit log (sourceId, from/to mode, counts — no
 * URL/content/secret). Review, backfill, conflict-resolution, and force-rescrape
 * are deliberately NOT exposed in this phase.
 */
export const POST = createCapabilityHandler(
  CAPABILITIES.sourcesManage,
  { params: idParams, body: actionBody },
  async ({ req, params, body, session, requestId }) => {
    const result = await applyLifecycleAction(params.id, body.action);
    if (!result.ok) {
      const mapped = FAILURE_RESPONSE[result.reason];
      throw new ApiError(mapped.status, mapped.message);
    }

    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.adminDiscoverySourceLifecycle,
      targetType: "discovery_source",
      targetId: params.id,
      metadata: {
        action: result.action,
        fromMode: result.fromMode,
        toMode: result.toMode,
        ...(result.queuedCount !== undefined ? { queuedCount: result.queuedCount } : {}),
        ...(result.deferredCount !== undefined ? { deferredCount: result.deferredCount } : {}),
        ...(result.cancelledJobCount !== undefined ? { cancelledJobCount: result.cancelledJobCount } : {}),
        ...(result.activationGeneration !== undefined ? { activationGeneration: result.activationGeneration } : {}),
      },
    });

    return NextResponse.json({
      ok: true,
      action: result.action,
      fromMode: result.fromMode,
      toMode: result.toMode,
      ...(result.queuedCount !== undefined ? { queuedCount: result.queuedCount } : {}),
      ...(result.deferredCount !== undefined ? { deferredCount: result.deferredCount } : {}),
      ...(result.cancelledJobCount !== undefined ? { cancelledJobCount: result.cancelledJobCount } : {}),
      ...(result.activationGeneration !== undefined ? { activationGeneration: result.activationGeneration } : {}),
    });
  },
);
