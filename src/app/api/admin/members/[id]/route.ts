import { NextResponse } from "next/server";
import { createAdminHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, oneOf } from "@/lib/validation";
import { updateMemberRole, deleteMember } from "@/lib/account-lifecycle";
import type { Role } from "@prisma/client";
import { AUDIT_ACTIONS, type AuditRequestInput } from "@/lib/security/audit";
import { throwIfFailed } from "@/lib/result";

const roleBody = object({ role: oneOf<Role>(["Admin", "Reader"]) });

type AdminMemberAuditContext = Pick<AuditRequestInput, "req" | "session" | "requestId"> & {
  targetId: string;
};

type UpdateMemberAuditResult = Parameters<NonNullable<Parameters<typeof updateMemberRole>[2]>>[0];
type DeleteMemberAuditResult = Parameters<NonNullable<Parameters<typeof deleteMember>[1]>>[0];

function assertNotSelfRoleRemoval(targetUserId: string, currentUserId: string, role: Role) {
  if (targetUserId === currentUserId && role !== "Admin") {
    throw new ApiError(409, "You cannot remove your own admin role");
  }
}

function assertNotSelfDelete(targetUserId: string, currentUserId: string) {
  if (targetUserId === currentUserId) {
    throw new ApiError(409, "You cannot remove your own account");
  }
}

function adminMemberAuditBase({ req, session, requestId, targetId }: AdminMemberAuditContext) {
  return {
    req,
    session,
    requestId,
    targetType: "user",
    targetId,
  };
}

function roleUpdateAudit(context: AdminMemberAuditContext) {
  return (auditResult: UpdateMemberAuditResult) => ({
    ...adminMemberAuditBase(context),
    action: AUDIT_ACTIONS.adminMemberRoleUpdate,
    metadata: {
      previousRole: auditResult.previousRole,
      role: auditResult.role,
      changed: auditResult.changed,
    },
  });
}

function memberDeleteAudit(context: AdminMemberAuditContext) {
  return (auditResult: DeleteMemberAuditResult) => ({
    ...adminMemberAuditBase(context),
    action: AUDIT_ACTIONS.adminMemberDelete,
    metadata: {
      role: auditResult.role,
      ownedArticleCount: auditResult.ownedArticleCount,
    },
  });
}

export const PATCH = createAdminHandler(
  { params: idParams, body: roleBody },
  async ({ req, params, body, session, requestId }) => {
    assertNotSelfRoleRemoval(params.id, session.user.id, body.role);
    const result = await updateMemberRole(
      params.id,
      body.role,
      roleUpdateAudit({ req, session, requestId, targetId: params.id }),
    );
    throwIfFailed(result);
    return NextResponse.json({ ok: true, role: result.role });
  },
);

export const DELETE = createAdminHandler(
  { params: idParams },
  async ({ req, params, session, requestId }) => {
    assertNotSelfDelete(params.id, session.user.id);
    const result = await deleteMember(
      params.id,
      memberDeleteAudit({ req, session, requestId, targetId: params.id }),
    );
    throwIfFailed(result);
    return NextResponse.json({ ok: true });
  },
);
