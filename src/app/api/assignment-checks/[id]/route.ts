import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { deleteAssignmentCheck } from "@/lib/classroom/activities";
import { activityError } from "@/lib/classroom/activities-http";

/** Removes a Check for Understanding and its answers (#1304). Classroom managers; audited. */
export const DELETE = createHandler({ params: idParams }, async ({ req, params, session, requestId }) => {
  const result = await deleteAssignmentCheck(session.user, params.id, ({ action, targetId, metadata }) => ({
    req,
    session,
    requestId,
    action,
    targetType: "assignment_check",
    targetId,
    metadata,
  }));
  if (!result.ok) throw activityError(result);
  return NextResponse.json({ ok: true });
});
