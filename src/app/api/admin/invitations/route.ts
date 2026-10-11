import { NextResponse } from "next/server";
import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { object, optional, string } from "@/lib/validation";
import {
  accountAdmissionMode,
  accountAdmissionSecretLink,
  createAccountInvitation,
  enforceAccountAdmissionRateLimit,
  listAccountInvitations,
} from "@/lib/account-admission";
import { AccountAdmissionError } from "@/lib/account-admission/errors";
import {
  AUDIT_ACTIONS,
  recordAuditFromRequest,
} from "@/lib/security/audit";

const createInvitationBody = object({
  email: string({ min: 3, max: 320 }),
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

function requireInvitationMode(): void {
  if (accountAdmissionMode() !== "invitation-only") {
    throw new AccountAdmissionError(
      409,
      "mode_mismatch",
      "Account invitations are disabled in public registration mode.",
    );
  }
}

function invitationView(invitation: {
  id: string;
  email: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
}) {
  return {
    id: invitation.id,
    email: invitation.email,
    status: invitation.status,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
    acceptedAt:
      "acceptedAt" in invitation && invitation.acceptedAt instanceof Date
        ? invitation.acceptedAt
        : null,
    revokedAt:
      "revokedAt" in invitation && invitation.revokedAt instanceof Date
        ? invitation.revokedAt
        : null,
  };
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
      expiresAt: requestedExpiry(body.expiresAt),
    });
    const delivery = grant.delivery;
    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.adminAccountInvitationCreate,
      targetType: "account_invitation",
      targetId: grant.invitation.id,
      metadata: {
        queued: delivery.queued,
        deliveryOutcome: delivery.queued ? "queued" : delivery.reason,
        expiresAt: grant.invitation.expiresAt.toISOString(),
      },
    });
    const acceptUrl = accountAdmissionSecretLink(
      "/invite",
      grant.token,
      req.url,
    );
    if (!acceptUrl) {
      throw new AccountAdmissionError(
        503,
        "public_url_unavailable",
        "The public application URL is unavailable.",
      );
    }
    return NextResponse.json(
      {
        ok: true,
        invitation: invitationView(grant.invitation),
        acceptUrl,
        delivery,
      },
      { status: 201 },
    );
  },
);
