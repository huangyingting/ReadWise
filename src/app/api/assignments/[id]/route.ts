import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, optional, string } from "@/lib/validation";
import {
  deleteAssignment,
  getAssignmentClassroom,
  updateAssignment,
} from "@/lib/classroom";
import { requireClassroomManageApi } from "@/lib/tenant-api";

const updateBody = object({
  dueDate: optional(string({ min: 1, max: 40 })),
  instructions: optional(string({ max: 2000 })),
});

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

/**
 * Edits an assignment's due date and/or instructions (RW-061). Requires the
 * caller to manage the assignment's classroom (teacher / org-admin / system
 * admin). Validates an optional due date parses to a real date.
 */
export const PATCH = createHandler(
  { params: idParams, body: updateBody },
  async ({ params, body, session }) => {
    const assignment = await getAssignmentClassroom(params.id);
    if (!assignment) throw new ApiError(404, "Assignment not found");
    await requireClassroomManageApi(session, assignment.classroomId);
    const result = await updateAssignment(params.id, {
      dueDate: body.dueDate,
      instructions: body.instructions,
    });
    if (!result.ok) {
      throw new ApiError(result.status, "Invalid due date");
    }
    return NextResponse.json({ assignment: result.assignment });
  },
);
