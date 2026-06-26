import { NextResponse } from "next/server";
import { createAdminHandler, ApiError } from "@/lib/api-handler";
import { idParams, object, oneOf } from "@/lib/validation";
import { updateMemberRole, deleteMember } from "@/lib/account-lifecycle";
import type { Role } from "@prisma/client";
import { AUDIT_ACTIONS } from "@/lib/security/audit";
import { throwIfFailed } from "@/lib/result";

const roleBody = object({ role: oneOf<Role>(["Admin", "Reader"]) });

export const PATCH = createAdminHandler(
  { params: idParams, body: roleBody },
  async ({ req, params, body, session, requestId }) => {
    if (params.id === session.user.id && body.role !== "Admin") {
      throw new ApiError(409, "You cannot remove your own admin role");
    }
    const result = await updateMemberRole(params.id, body.role, (auditResult) => ({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.adminMemberRoleUpdate,
      targetType: "user",
      targetId: params.id,
      metadata: {
        previousRole: auditResult.previousRole,
        role: auditResult.role,
        changed: auditResult.changed,
      },
    }));
    throwIfFailed(result);
    return NextResponse.json({ ok: true, role: result.role });
  },
);

export const DELETE = createAdminHandler(
  { params: idParams },
  async ({ req, params, session, requestId }) => {
    if (params.id === session.user.id) {
      throw new ApiError(409, "You cannot remove your own account");
    }
    const result = await deleteMember(params.id, (auditResult) => ({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.adminMemberDelete,
      targetType: "user",
      targetId: params.id,
      metadata: {
        role: auditResult.role,
        ownedArticleCount: auditResult.ownedArticleCount,
      },
    }));
    throwIfFailed(result);
    return NextResponse.json({ ok: true });
  },
);
