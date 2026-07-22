import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { object, nonEmptyString } from "@/lib/validation";
import { getAssignmentClassroom, reopenAssignment } from "@/lib/classroom";
import { requireActiveClassroomManageApi } from "@/lib/tenant-api";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";

const reopenParams = object({ id: nonEmptyString(200) });

export const POST = createHandler(
  { params: reopenParams },
  async ({ req, params, session, requestId }) => {
    const assignment = await getAssignmentClassroom(params.id);
    if (!assignment) throw new ApiError(404, "Assignment not found");
    await requireActiveClassroomManageApi(session, assignment.classroomId);

    const result = await reopenAssignment(params.id);

    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.assignmentReopen,
      targetType: "assignment",
      targetId: params.id,
      metadata: {
        assignmentId: params.id,
        classroomId: assignment.classroomId,
        reopened: result.reopened,
      },
    });

    return NextResponse.json({ result });
  },
);
