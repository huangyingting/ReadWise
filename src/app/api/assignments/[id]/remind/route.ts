import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { object, nonEmptyString } from "@/lib/validation";
import { getAssignmentClassroom } from "@/lib/classroom";
import { remindAssignmentStudents } from "@/lib/push/assignment-reminders";
import { requireActiveClassroomManageApi } from "@/lib/tenant-api";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";

const remindParams = object({ id: nonEmptyString(200) });

/**
 * Teacher nudge (GAP-5): remind every enrolled student who has not completed
 * this assignment, using the assignment reminder push channel (GAP-1b).
 * Manage-gated on the assignment's classroom. Metadata-only audit (counts,
 * never student ids or content).
 */
export const POST = createHandler(
  { params: remindParams },
  async ({ req, params, session, requestId }) => {
    const assignment = await getAssignmentClassroom(params.id);
    if (!assignment) throw new ApiError(404, "Assignment not found");
    await requireActiveClassroomManageApi(session, assignment.classroomId);

    const result = await remindAssignmentStudents(params.id);
    if (!result) throw new ApiError(404, "Assignment not found");

    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.assignmentRemind,
      targetType: "assignment",
      targetId: params.id,
      metadata: {
        assignmentId: params.id,
        classroomId: assignment.classroomId,
        total: result.total,
        notified: result.notified,
      },
    });

    return NextResponse.json({ result });
  },
);
