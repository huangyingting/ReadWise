import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { reviewWriteSubmission } from "@/lib/classroom/writing";
import { reviewBody, writeError } from "@/lib/classroom/writing-http";

/**
 * Grades or returns an assignment response for revision (#1305). Classroom
 * managers only; independent writing is not reviewable. Audited (ids, action,
 * rubric totals — never the text).
 */
export const POST = createHandler(
  { params: idParams, body: reviewBody },
  async ({ req, params, body, session, requestId }) => {
    const result = await reviewWriteSubmission(params.id, session.user, body, ({ action, metadata }) => ({
      req,
      session,
      requestId,
      action,
      targetType: "write_submission",
      targetId: params.id,
      metadata,
    }));
    if (!result.ok) throw writeError(result);
    return NextResponse.json({ submission: result.submission });
  },
);
