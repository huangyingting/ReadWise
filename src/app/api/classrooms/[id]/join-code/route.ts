import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams, nullable, number, object } from "@/lib/validation";
import {
  disableClassroomJoinCode,
  getClassroomJoinCodeView,
  rotateClassroomJoinCode,
  toJoinCodeView,
} from "@/lib/classroom";
import { JOIN_CODE_MAX_EXPIRY_DAYS, JOIN_CODE_MAX_USES_LIMIT } from "@/lib/classroom/join-code-format";
import { requireActiveClassroomManageApi, requireClassroomManageApi } from "@/lib/tenant-api";
import { AUDIT_ACTIONS } from "@/lib/security/audit";

const rotateJoinCodeBody = object({
  expiresInDays: nullable(number({ int: true, min: 1, max: JOIN_CODE_MAX_EXPIRY_DAYS })),
  maxUses: nullable(number({ int: true, min: 1, max: JOIN_CODE_MAX_USES_LIMIT })),
});

/** Current join code for a classroom the caller manages (null when none). */
export const GET = createHandler({ params: idParams }, async ({ params, session }) => {
  await requireClassroomManageApi(session, params.id);
  return NextResponse.json({ joinCode: await getClassroomJoinCodeView(params.id) });
});

/**
 * Generates or rotates the classroom's join code (#1309). Rotating invalidates
 * the previous code immediately and resets usage. Archived classrooms refuse.
 * The audit row is written in the rotation's transaction and never contains
 * the code itself.
 */
export const POST = createHandler(
  { params: idParams, body: rotateJoinCodeBody },
  async ({ req, params, body, session, requestId }) => {
    const { classroom } = await requireActiveClassroomManageApi(session, params.id);
    const { joinCode } = await rotateClassroomJoinCode({
      classroomId: params.id,
      actorId: session.user.id,
      expiresInDays: body.expiresInDays ?? null,
      maxUses: body.maxUses ?? null,
      audit: ({ joinCode: rotated, replaced }) => ({
        req,
        session,
        requestId,
        action: AUDIT_ACTIONS.classroomJoinCodeRotated,
        targetType: "classroom",
        targetId: params.id,
        metadata: {
          orgId: classroom.orgId,
          replaced,
          expires: rotated.expiresAt !== null,
          maxUses: rotated.maxUses,
        },
      }),
    });
    return NextResponse.json({ ok: true, joinCode: toJoinCodeView(joinCode) });
  },
);

/**
 * Disables the classroom's join code; allowed on archived classrooms too.
 * Repeating it is a no-op that is not audited again.
 */
export const DELETE = createHandler({ params: idParams }, async ({ req, params, session, requestId }) => {
  const { classroom } = await requireClassroomManageApi(session, params.id);
  const result = await disableClassroomJoinCode(params.id, {
    audit: () => ({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.classroomJoinCodeDisabled,
      targetType: "classroom",
      targetId: params.id,
      metadata: { orgId: classroom.orgId },
    }),
  });
  if (result === "not_found") throw new ApiError(404, "Classroom has no join code");
  return NextResponse.json({ ok: true, joinCode: await getClassroomJoinCodeView(params.id) });
});
