import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, optional, string } from "@/lib/validation";
import {
  deleteAssignment,
  getAssignmentClassroom,
  getAssignmentDetail,
  updateAssignment,
} from "@/lib/classroom";
import { requireActiveClassroomManageApi } from "@/lib/tenant-api";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";

const updateBody = object({
  dueDate: optional(string({ min: 1, max: 40 })),
  instructions: optional(string({ max: 2000 })),
});

export const GET = createHandler(
  { params: idParams },
  async ({ params, session }) => {
    const assignment = await getAssignmentClassroom(params.id);
    if (!assignment) throw new ApiError(404, "Assignment not found");
    await requireActiveClassroomManageApi(session, assignment.classroomId);
    const detail = await getAssignmentDetail(params.id);
    if (!detail) throw new ApiError(404, "Assignment not found");
    return NextResponse.json({ assignment: detail });
  },
);

export const DELETE = createHandler(
  { params: idParams },
  async ({ req, params, session, requestId }) => {
    const assignment = await getAssignmentClassroom(params.id);
    if (!assignment) throw new ApiError(404, "Assignment not found");
    await requireActiveClassroomManageApi(session, assignment.classroomId);
    await deleteAssignment(params.id);
    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.assignmentDelete,
      targetType: "assignment",
      targetId: params.id,
      metadata: { assignmentId: params.id, classroomId: assignment.classroomId },
    });
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
  async ({ req, params, body, session, requestId }) => {
    const assignment = await getAssignmentClassroom(params.id);
    if (!assignment) throw new ApiError(404, "Assignment not found");
    await requireActiveClassroomManageApi(session, assignment.classroomId);
    const result = await updateAssignment(params.id, {
      dueDate: body.dueDate,
      instructions: body.instructions,
    });
    if (!result.ok) {
      throw new ApiError(result.status, "Invalid due date");
    }
    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.assignmentUpdate,
      targetType: "assignment",
      targetId: params.id,
      metadata: {
        assignmentId: params.id,
        classroomId: assignment.classroomId,
        changed: {
          dueDate: body.dueDate !== undefined,
          instructions: body.instructions !== undefined,
        },
      },
    });
    return NextResponse.json({ assignment: result.assignment });
  },
);
