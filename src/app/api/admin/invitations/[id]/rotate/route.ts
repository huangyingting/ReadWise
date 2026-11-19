import { NextResponse } from "next/server";
import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { idParams, object, optional, string } from "@/lib/validation";
import {
  enforceAccountAdmissionRateLimit,
  rotateAccountInvitation,
} from "@/lib/account-admission";
import {
  invitationAcceptUrl,
  invitationGrantAuditMetadata,
  invitationView,
  requestedInvitationExpiry,
} from "@/lib/account-admission/invitation-http";
import {
  AUDIT_ACTIONS,
  recordAuditFromRequest,
} from "@/lib/security/audit";

const rotateBody = object({
  expiresAt: optional(string({ min: 1, max: 100 })),
});

export const POST = createCapabilityHandler(
  CAPABILITIES.membersManage,
  { params: idParams, body: rotateBody },
  async ({ req, params, body, session, requestId }) => {
    await enforceAccountAdmissionRateLimit(req);
    const grant = await rotateAccountInvitation(
      params.id,
      requestedInvitationExpiry(body.expiresAt),
    );
    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.adminAccountInvitationRotate,
      targetType: "account_invitation",
      targetId: grant.invitation.id,
      metadata: invitationGrantAuditMetadata(grant),
    });
    return NextResponse.json({
      ok: true,
      invitation: invitationView(grant.invitation),
      acceptUrl: invitationAcceptUrl(grant, req.url),
      delivery: grant.delivery,
    });
  },
);
