import { NextResponse } from "next/server";
import { createCapabilityHandler, ApiError } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { idParams, object, oneOf } from "@/lib/validation";
import { updateReportStatus, ContentReportStatus } from "@/lib/moderation/reports";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";

const TERMINAL_STATUSES = [ContentReportStatus.RESOLVED, ContentReportStatus.DISMISSED] as const;

const patchBody = object({
  status: oneOf(TERMINAL_STATUSES),
});

/**
 * PATCH /api/admin/reports/[id] — update report status (resolve or dismiss).
 * Gated on `content.moderate`. Audited.
 */
export const PATCH = createCapabilityHandler(
  CAPABILITIES.contentModerate,
  { params: idParams, body: patchBody },
  async ({ req, params, body, session, requestId }) => {
    const result = await updateReportStatus({
      reportId: params.id,
      status: body.status,
      resolvedBy: session.user.id,
    });

    if (!result.ok) {
      throw new ApiError(result.status, result.error);
    }

    const action =
      body.status === ContentReportStatus.DISMISSED
        ? AUDIT_ACTIONS.adminReportDismiss
        : AUDIT_ACTIONS.adminReportResolve;

    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action,
      targetType: "content_report",
      targetId: params.id,
      metadata: { status: body.status },
    });

    return NextResponse.json({ ok: true, reportId: result.reportId, status: result.status });
  },
);
