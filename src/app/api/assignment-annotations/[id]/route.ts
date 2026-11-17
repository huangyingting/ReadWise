import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { deleteGuidedAnnotation, updateGuidedAnnotation } from "@/lib/classroom/annotations";
import { annotationError, updateGuideBody } from "@/lib/classroom/annotations-http";
import type { AuditAction } from "@/lib/security/audit";
import type { Session } from "next-auth";

function auditFactory(req: Request, session: Session, requestId: string) {
  return ({ action, targetId, metadata }: { action: AuditAction; targetId: string; metadata: Record<string, unknown> }) => ({
    req,
    session,
    requestId,
    action,
    targetType: "assignment_annotation",
    targetId,
    metadata,
  });
}

/** Edits a guided prompt's text (#1307). Classroom managers only; audited. */
export const PATCH = createHandler(
  { params: idParams, body: updateGuideBody },
  async ({ req, params, body, session, requestId }) => {
    const result = await updateGuidedAnnotation(session.user, params.id, body.prompt, auditFactory(req, session, requestId));
    if (!result.ok) throw annotationError(result);
    return NextResponse.json({ guide: result.guide });
  },
);

/** Deletes a guided prompt and its replies (#1307). Classroom managers only; audited. */
export const DELETE = createHandler({ params: idParams }, async ({ req, params, session, requestId }) => {
  const result = await deleteGuidedAnnotation(session.user, params.id, auditFactory(req, session, requestId));
  if (!result.ok) throw annotationError(result);
  return NextResponse.json({ ok: true });
});
