import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { boolean, idParams, object, optional, string } from "@/lib/validation";
import { requireClassroomManageApi } from "@/lib/tenant-api";
import { updateClassroomLifecycle, deleteClassroom } from "@/lib/classroom";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";

const updateClassroomBody = object({
  name: optional(string({ min: 1, max: 120 })),
  archived: optional(boolean()),
});

function classroomLifecycleInput(body: { name?: string; archived?: boolean }) {
  return {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.archived !== undefined ? { archived: body.archived } : {}),
  };
}

/**
 * Returns classroom detail when the caller can manage the classroom.
 */
export const GET = createHandler(
  { params: idParams },
  async ({ params, session }) => {
    const { classroom } = await requireClassroomManageApi(session, params.id);
    return NextResponse.json({ classroom });
  },
);

export const PATCH = createHandler(
  { params: idParams, body: updateClassroomBody },
  async ({ req, params, body, session, requestId }) => {
    await requireClassroomManageApi(session, params.id);
    const result = await updateClassroomLifecycle(params.id, classroomLifecycleInput(body));
    if (!result.ok) {
      throw new ApiError(result.status, "At least one lifecycle field is required");
    }

    if (result.changed.name) {
      await recordAuditFromRequest({
        req,
        session,
        requestId,
        action: AUDIT_ACTIONS.classroomRename,
        targetType: "classroom",
        targetId: params.id,
        metadata: { orgId: result.classroom.orgId },
      });
    }
    if (result.changed.archived) {
      await recordAuditFromRequest({
        req,
        session,
        requestId,
        action: result.classroom.archivedAt
          ? AUDIT_ACTIONS.classroomArchive
          : AUDIT_ACTIONS.classroomUnarchive,
        targetType: "classroom",
        targetId: params.id,
        metadata: { orgId: result.classroom.orgId },
      });
    }

    return NextResponse.json({ ok: true, classroom: result.classroom });
  },
);

export const DELETE = createHandler(
  { params: idParams },
  async ({ req, params, session, requestId }) => {
    const { classroom } = await requireClassroomManageApi(session, params.id);
    const result = await deleteClassroom(params.id);
    if (!result.ok) {
      throw new ApiError(result.status, "Classroom is not empty");
    }
    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.classroomDelete,
      targetType: "classroom",
      targetId: params.id,
      metadata: {
        orgId: classroom.orgId,
        deleted: result.deleted,
      },
    });
    return NextResponse.json({ ok: true });
  },
);
