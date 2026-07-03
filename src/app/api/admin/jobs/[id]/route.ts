import { NextResponse } from "next/server";
import { createAdminHandler } from "@/lib/api-handler";
import { idParams, object, oneOf } from "@/lib/validation";
import { runJobAction, JOB_ACTIONS, type JobActionName } from "@/lib/admin/jobs";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";
import { throwIfFailed } from "@/lib/result";

const actionBody = object({ action: oneOf<JobActionName>(JOB_ACTIONS) });

const AUDIT_ACTION_FOR: Record<JobActionName, string> = {
  retry: AUDIT_ACTIONS.adminJobRetry,
  cancel: AUDIT_ACTIONS.adminJobCancel,
  archive: AUDIT_ACTIONS.adminJobArchive,
};

type SuccessfulJobActionResult = Extract<
  Awaited<ReturnType<typeof runJobAction>>,
  { ok: true }
>;

function auditMetadataFor(result: SuccessfulJobActionResult) {
  return {
    action: result.action,
    previousStatus: result.previousStatus,
    type: result.job.type,
    status: result.job.status,
  };
}

function actionResponseFor(result: SuccessfulJobActionResult) {
  return {
    ok: true,
    action: result.action,
    job: { id: result.job.id, status: result.job.status, type: result.job.type },
  };
}

export const POST = createAdminHandler(
  { params: idParams, body: actionBody },
  async ({ req, params, body, session, requestId }) => {
    const result = await runJobAction(params.id, body.action);
    throwIfFailed(result);
    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTION_FOR[body.action],
      targetType: "job",
      targetId: params.id,
      metadata: auditMetadataFor(result),
    });
    return NextResponse.json(actionResponseFor(result));
  },
);
