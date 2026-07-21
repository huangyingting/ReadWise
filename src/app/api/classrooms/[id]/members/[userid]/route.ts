import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { object, nonEmptyString } from "@/lib/validation";
import { removeClassroomMember } from "@/lib/classroom";
import { requireActiveClassroomManageApi } from "@/lib/tenant-api";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";

const classroomMemberParams = object({
  id: nonEmptyString(200),
  userid: nonEmptyString(200),
});

export const DELETE = createHandler(
  { params: classroomMemberParams },
  async ({ req, params, session, requestId }) => {
    const { classroom } = await requireActiveClassroomManageApi(session, params.id);
    await removeClassroomMember(params.id, params.userid);
    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.classroomMemberRemove,
      targetType: "classroom_member",
      targetId: params.userid,
      metadata: { classroomId: params.id, orgId: classroom.orgId, targetUserId: params.userid },
    });
    return NextResponse.json({ ok: true });
  },
);
