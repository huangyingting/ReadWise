import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { addAssignmentCheck } from "@/lib/classroom/activities";
import { activityError, checkBody } from "@/lib/classroom/activities-http";

/** Adds a Check for Understanding after a reading block (#1304). Classroom managers; audited. */
export const POST = createHandler({ params: idParams, body: checkBody }, async ({ req, params, body, session, requestId }) => {
  const result = await addAssignmentCheck(session.user, params.id, body, ({ action, targetId, metadata }) => ({
    req,
    session,
    requestId,
    action,
    targetType: "assignment_check",
    targetId,
    metadata,
  }));
  if (!result.ok) throw activityError(result);
  return NextResponse.json({ checkId: result.checkId }, { status: 201 });
});
