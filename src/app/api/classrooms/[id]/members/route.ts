import { NextResponse } from "next/server";
import type { ClassroomRole } from "@prisma/client";
import { createHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, oneOf, optional, nonEmptyString } from "@/lib/validation";
import { CLASSROOM_ROLES } from "@/lib/rbac";
import { addClassroomMember } from "@/lib/classroom";
import { requireActiveClassroomManageApi, requireClassroomManageApi } from "@/lib/tenant-api";
import { getMembership } from "@/lib/org/queries";
import { AUDIT_ACTIONS, recordAuditFromRequest } from "@/lib/security/audit";

const CREATED_RESPONSE_INIT = { status: 201 } as const;
const DEFAULT_CLASSROOM_ROLE = "Student" satisfies ClassroomRole;

const addClassroomMemberBody = object({
  userId: nonEmptyString(200),
  role: optional(oneOf<ClassroomRole>(CLASSROOM_ROLES)),
});

type ClassroomSession = Parameters<typeof requireClassroomManageApi>[0];
type ClassroomMember = Awaited<ReturnType<typeof addClassroomMember>>;

function classroomRoleOrDefault(role: ClassroomRole | undefined): ClassroomRole {
  return role ?? DEFAULT_CLASSROOM_ROLE;
}

async function requireClassroomMemberManagement(session: ClassroomSession, classroomId: string) {
  return requireActiveClassroomManageApi(session, classroomId);
}

async function requireTargetOrgMembership(userId: string, orgId: string): Promise<void> {
  const membership = await getMembership(userId, orgId);
  if (!membership) {
    throw new ApiError(403, "Forbidden");
  }
}

function classroomMemberCreatedResponse(member: ClassroomMember) {
  return NextResponse.json({ ok: true, member }, CREATED_RESPONSE_INIT);
}

/**
 * Adds (or re-roles) a member of a classroom (RW-061). Requires the caller to
 * manage the classroom (its teacher, the org admin, or a system admin). Defaults
 * the role to Student.
 */
export const POST = createHandler(
  { params: idParams, body: addClassroomMemberBody },
  async ({ req, params, body, session, requestId }) => {
    const { classroom } = await requireClassroomMemberManagement(session, params.id);
    await requireTargetOrgMembership(body.userId, classroom.orgId);
    const role = classroomRoleOrDefault(body.role);
    const member = await addClassroomMember(
      params.id,
      body.userId,
      role,
    );
    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.classroomMemberAdd,
      targetType: "classroom_member",
      targetId: body.userId,
      metadata: { classroomId: params.id, orgId: classroom.orgId, targetUserId: body.userId, role },
    });
    return classroomMemberCreatedResponse(member);
  },
);
