import { NextResponse } from "next/server";
import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { idParams, object, optional, string } from "@/lib/validation";
import {
  enforceAccountAdmissionRateLimit,
  rotateAccountInvitation,
  sendAccountInvitationEmail,
} from "@/lib/account-admission";
import { AccountAdmissionError } from "@/lib/account-admission/errors";
import {
  AUDIT_ACTIONS,
  recordAuditFromRequest,
} from "@/lib/security/audit";

const rotateBody = object({
  expiresAt: optional(string({ min: 1, max: 100 })),
});

function requestedExpiry(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const expiresAt = new Date(value);
  if (!Number.isFinite(expiresAt.getTime())) {
    throw new AccountAdmissionError(
      400,
      "invalid_expiry",
      "Invitation expiry must be a valid date.",
    );
  }
  return expiresAt;
}

export const POST = createCapabilityHandler(
  CAPABILITIES.membersManage,
  { params: idParams, body: rotateBody },
  async ({ req, params, body, session, requestId }) => {
    await enforceAccountAdmissionRateLimit(req);
    const grant = await rotateAccountInvitation(
      params.id,
      requestedExpiry(body.expiresAt),
    );
    const delivery = await sendAccountInvitationEmail({
      email: grant.invitation.email,
      token: grant.token,
    });
    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.adminAccountInvitationRotate,
      targetType: "account_invitation",
      targetId: grant.invitation.id,
      metadata: {
        delivered: delivery.delivered,
        expiresAt: grant.invitation.expiresAt.toISOString(),
      },
    });
    const acceptUrl = new URL(
      `/invite/${encodeURIComponent(grant.token)}`,
      req.url,
    ).toString();
    return NextResponse.json({
      ok: true,
      invitation: {
        id: grant.invitation.id,
        email: grant.invitation.email,
        status: grant.invitation.status,
        expiresAt: grant.invitation.expiresAt,
        createdAt: grant.invitation.createdAt,
        acceptedAt: grant.invitation.acceptedAt,
        revokedAt: grant.invitation.revokedAt,
      },
      acceptUrl,
      delivery,
    });
  },
);
