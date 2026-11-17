import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import type { AuditAction } from "@/lib/security/audit";
import { deleteAssignmentPoll, saveAssignmentPoll } from "@/lib/classroom/activities";
import { activityError, pollBody } from "@/lib/classroom/activities-http";

function auditFactory(req: Request, session: Session, requestId: string) {
  return ({ action, targetId, metadata }: { action: AuditAction; targetId: string; metadata: Record<string, unknown> }) => ({
    req,
    session,
    requestId,
    action,
    targetType: "assignment_poll",
    targetId,
    metadata,
  });
}

/** Creates or replaces the assignment's pre-reading poll (#1304). Classroom managers; audited. */
export const PUT = createHandler({ params: idParams, body: pollBody }, async ({ req, params, body, session, requestId }) => {
  const result = await saveAssignmentPoll(session.user, params.id, body, auditFactory(req, session, requestId));
  if (!result.ok) throw activityError(result);
  return NextResponse.json({ pollId: result.pollId });
});

/** Removes the assignment's poll and votes (#1304). Classroom managers; audited. */
export const DELETE = createHandler({ params: idParams }, async ({ req, params, session, requestId }) => {
  const result = await deleteAssignmentPoll(session.user, params.id, auditFactory(req, session, requestId));
  if (!result.ok) throw activityError(result);
  return NextResponse.json({ ok: true });
});
