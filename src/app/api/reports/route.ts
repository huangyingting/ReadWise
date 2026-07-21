import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { object, nonEmptyString, optional, string, oneOf } from "@/lib/validation";
import {
  createContentReport,
  REPORT_REASONS,
  type CreateContentReportResult,
} from "@/lib/moderation/reports";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";

type ReportReason = (typeof REPORT_REASONS)[number];

const reportBody = object({
  articleId: nonEmptyString(200),
  reason: oneOf(REPORT_REASONS),
  note: optional(string({ max: 500 })),
});

function throwIfReportFailed(
  result: CreateContentReportResult,
): asserts result is Extract<CreateContentReportResult, { ok: true }> {
  if (!result.ok) {
    throw new ApiError(result.status, result.error);
  }
}

function reportAuditMetadata(reason: ReportReason) {
  return { reason };
}

/**
 * POST /api/reports — authenticated user submits a content report.
 * Rate-limited via 1-hour dedup window per (user, article, reason) in the
 * command layer. No raw article text or selected text is stored.
 */
export const POST = createHandler({ body: reportBody }, async ({ req, body, session, requestId }) => {
  const result = await createContentReport({
    reporter: { id: session.user.id, role: session.user.role },
    articleId: body.articleId,
    reason: body.reason,
    note: body.note ?? null,
  });

  throwIfReportFailed(result);

  await recordAuditFromRequest({
    req,
    session,
    requestId,
    action: AUDIT_ACTIONS.userContentReport,
    targetType: "article",
    targetId: body.articleId,
    metadata: reportAuditMetadata(body.reason),
  });

  return NextResponse.json({ ok: true, reportId: result.reportId }, { status: 201 });
});
