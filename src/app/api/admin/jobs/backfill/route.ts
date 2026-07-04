import { NextResponse } from "next/server";
import { createCapabilityHandler, ApiError } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { object, array, oneOf, string, nonEmptyString, optional, boolean, number } from "@/lib/validation";
import {
  runBackfill,
  BackfillError,
  BACKFILL_FEATURES,
  type BackfillFeature,
} from "@/lib/processing/backfill";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";

const backfillBody = object({
  features: array(oneOf<BackfillFeature>(BACKFILL_FEATURES), { max: BACKFILL_FEATURES.length }),
  mode: optional(oneOf<"missing" | "rebuild">(["missing", "rebuild"])),
  reason: nonEmptyString(500),
  dryRun: optional(boolean()),
  batchCap: optional(number({ min: 1, max: 500, int: true })),
  status: optional(string({ max: 40 })),
  category: optional(string({ max: 120 })),
  translateLangs: optional(array(nonEmptyString(10), { max: 20 })),
  articleIds: optional(array(nonEmptyString(200), { max: 500 })),
});

type BackfillRequestBody = {
  features: BackfillFeature[];
  mode?: "missing" | "rebuild";
  reason: string;
  dryRun?: boolean;
  batchCap?: number;
  status?: string;
  category?: string;
  translateLangs?: string[];
  articleIds?: string[];
};

type BackfillResult = Awaited<ReturnType<typeof runBackfill>>;

async function runBackfillOrApiError(
  body: BackfillRequestBody,
  operatorId: string,
): Promise<BackfillResult> {
  try {
    return await runBackfill({
      features: body.features,
      mode: body.mode,
      reason: body.reason,
      operatorId,
      dryRun: body.dryRun,
      batchCap: body.batchCap,
      translateLangs: body.translateLangs,
      filter: {
        status: body.status,
        category: body.category,
        articleIds: body.articleIds,
      },
    });
  } catch (err) {
    if (err instanceof BackfillError) {
      throw new ApiError(err.status, err.message);
    }
    throw err;
  }
}

function backfillAuditMetadata(result: BackfillResult) {
  return {
    mode: result.mode,
    features: result.features,
    reason: result.reason,
    dryRun: result.dryRun,
    scanned: result.scanned,
    matched: result.matched,
    cap: result.cap,
    enqueued: result.enqueued,
    skippedExisting: result.skippedExisting,
    cleared: result.cleared,
  };
}

export const POST = createCapabilityHandler(
  CAPABILITIES.jobsManage,
  { body: backfillBody },
  async ({ req, body, session, requestId }) => {
    const result = await runBackfillOrApiError(body, session.user.id);

    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.adminJobBackfill,
      targetType: "job_backfill",
      targetId: null,
      metadata: backfillAuditMetadata(result),
    });

    return NextResponse.json(result);
  },
);
