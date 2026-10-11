import { NextResponse } from "next/server";
import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { idParams } from "@/lib/validation";
import {
  enforceAccountAdmissionRateLimit,
  revokeAccountInvitation,
} from "@/lib/account-admission";
import {
  AUDIT_ACTIONS,
  recordAuditFromRequest,
} from "@/lib/security/audit";

export const DELETE = createCapabilityHandler(
  CAPABILITIES.membersManage,
  { params: idParams },
  async ({ req, params, session, requestId }) => {
    await enforceAccountAdmissionRateLimit(req);
    const invitation = await revokeAccountInvitation(params.id);
    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.adminAccountInvitationRevoke,
      targetType: "account_invitation",
      targetId: invitation.id,
      metadata: { status: invitation.status },
    });
    return NextResponse.json({
      ok: true,
      invitation: {
        id: invitation.id,
        email: invitation.email,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt,
        acceptedAt: invitation.acceptedAt,
        revokedAt: invitation.revokedAt,
      },
    });
  },
);
