import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { object, nonEmptyString, optional, string, oneOf } from "@/lib/validation";
import { createContentReport, REPORT_REASONS } from "@/lib/moderation/reports";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";

const reportBody = object({
  articleId: nonEmptyString(200),
  reason: oneOf(REPORT_REASONS),
  note: optional(string({ max: 500 })),
});

/**
 * POST /api/reports — authenticated user submits a content report.
 * Rate-limited via 1-hour dedup window per (user, article, reason) in the
 * command layer. No raw article text or selected text is stored.
 */
export const POST = createHandler({ body: reportBody }, async ({ req, body, session, requestId }) => {
  const result = await createContentReport({
    reporterUserId: session.user.id,
    articleId: body.articleId,
    reason: body.reason,
    note: body.note ?? null,
  });

  if (!result.ok) {
    throw new ApiError(result.status, result.error);
  }

  await recordAuditFromRequest({
    req,
    session,
    requestId,
    action: AUDIT_ACTIONS.userContentReport,
    targetType: "article",
    targetId: body.articleId,
    metadata: { reason: body.reason },
  });

  return NextResponse.json({ ok: true, reportId: result.reportId }, { status: 201 });
});
