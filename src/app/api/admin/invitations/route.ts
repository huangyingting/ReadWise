import { NextResponse } from "next/server";
import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { object, optional, string } from "@/lib/validation";
import {
  accountAdmissionMode,
  createAccountInvitation,
  enforceAccountAdmissionRateLimit,
  listAccountInvitations,
} from "@/lib/account-admission";
import { AccountAdmissionError } from "@/lib/account-admission/errors";
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

const createInvitationBody = object({
  email: string({ min: 3, max: 320 }),
  expiresAt: optional(string({ min: 1, max: 100 })),
});

function requireInvitationMode(): void {
  if (accountAdmissionMode() !== "invitation-only") {
    throw new AccountAdmissionError(
      409,
      "mode_mismatch",
      "Account invitations are disabled in public registration mode.",
    );
  }
}

export const GET = createCapabilityHandler(
  CAPABILITIES.membersManage,
  {},
  async () => {
    requireInvitationMode();
    return NextResponse.json({
      invitations: await listAccountInvitations(),
    });
  },
);

export const POST = createCapabilityHandler(
  CAPABILITIES.membersManage,
  { body: createInvitationBody },
  async ({ req, body, session, requestId }) => {
    requireInvitationMode();
    await enforceAccountAdmissionRateLimit(req, body.email);
    const grant = await createAccountInvitation({
      email: body.email,
      invitedById: session.user.id,
      expiresAt: requestedInvitationExpiry(body.expiresAt),
    });
    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.adminAccountInvitationCreate,
      targetType: "account_invitation",
      targetId: grant.invitation.id,
      metadata: invitationGrantAuditMetadata(grant),
    });
    return NextResponse.json(
      {
        ok: true,
        invitation: invitationView(grant.invitation),
        acceptUrl: invitationAcceptUrl(grant, req.url),
        delivery: grant.delivery,
      },
      { status: 201 },
    );
  },
);
