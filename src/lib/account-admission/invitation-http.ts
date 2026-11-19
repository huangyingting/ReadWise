/**
 * Request/response helpers shared by the admin invitation routes
 * (create, rotate, revoke). Audit metadata carries ids, delivery outcome, and
 * expiry only — never the invitation token or accept URL.
 */
import type { AccountInvitation } from "@prisma/client";
import { accountAdmissionSecretLink } from "@/lib/account-admission";
import { AccountAdmissionError } from "./errors";
import type { AccountInvitationGrant } from "./invitations";

/** Parses an optional admin-supplied expiry; 400 when it isn't a date. */
export function requestedInvitationExpiry(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const expiresAt = new Date(value);
  if (!Number.isFinite(expiresAt.getTime())) {
    throw new AccountAdmissionError(400, "invalid_expiry", "Invitation expiry must be a valid date.");
  }
  return expiresAt;
}

/** The admin-facing invitation shape (no token hash). */
export function invitationView(invitation: AccountInvitation) {
  return {
    id: invitation.id,
    email: invitation.email,
    status: invitation.status,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
    acceptedAt: invitation.acceptedAt,
    revokedAt: invitation.revokedAt,
  };
}

/** Content-free audit metadata for a newly issued invitation link. */
export function invitationGrantAuditMetadata(grant: AccountInvitationGrant) {
  return {
    queued: grant.delivery.queued,
    deliveryOutcome: grant.delivery.queued ? "queued" : grant.delivery.reason,
    expiresAt: grant.invitation.expiresAt.toISOString(),
  };
}

/** The absolute accept link for a grant; 503 when no public URL is configured. */
export function invitationAcceptUrl(grant: AccountInvitationGrant, requestUrl: string): string {
  const acceptUrl = accountAdmissionSecretLink("/invite", grant.token, requestUrl);
  if (!acceptUrl) {
    throw new AccountAdmissionError(503, "public_url_unavailable", "The public application URL is unavailable.");
  }
  return acceptUrl;
}
