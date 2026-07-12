import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams } from "@/lib/validation";
import { deleteAssignment, getAssignmentClassroom } from "@/lib/classroom";
import { requireClassroomManageApi } from "@/lib/tenant-api";

export const DELETE = createHandler(
  { params: idParams },
  async ({ params, session }) => {
    const assignment = await getAssignmentClassroom(params.id);
    if (!assignment) throw new ApiError(404, "Assignment not found");
    await requireClassroomManageApi(session, assignment.classroomId);
    await deleteAssignment(params.id);
    return NextResponse.json({ ok: true });
  },
);
