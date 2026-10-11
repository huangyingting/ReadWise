import { Prisma, type AccountInvitation } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runSerializableTransaction } from "@/lib/database/serializable-transaction";
import { AccountAdmissionError } from "./errors";
import {
  queueAccountInvitationEmail,
  type EmailDeliveryResult,
} from "./email";
import { isValidAccountEmail, normalizeAccountEmail } from "./policy";
import { createOpaqueToken, hashOpaqueToken } from "./tokens";

const DEFAULT_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type CreateAccountInvitationInput = {
  email: string;
  invitedById: string;
  expiresAt?: Date;
};

export type AccountInvitationGrant = {
  invitation: AccountInvitation;
  token: string;
  delivery: EmailDeliveryResult;
};

export type PublicInvitationView = {
  id: string;
  status: "pending" | "accepted" | "revoked" | "expired" | "invalid";
  maskedEmail: string | null;
  expiresAt: Date | null;
};

function invitationExpiry(now: Date, requested?: Date): Date {
  const expiresAt = requested ?? new Date(now.getTime() + DEFAULT_INVITATION_TTL_MS);
  if (expiresAt.getTime() <= now.getTime()) {
    throw new AccountAdmissionError(
      400,
      "invalid_expiry",
      "Invitation expiry must be in the future.",
    );
  }
  return expiresAt;
}

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  if (!domain) return "***";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(1, local.length - visible.length))}@${domain}`;
}

function isUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export async function expirePendingInvitations(now = new Date()): Promise<number> {
  const result = await prisma.accountInvitation.updateMany({
    where: {
      status: "PENDING",
      expiresAt: { lte: now },
    },
    data: {
      status: "EXPIRED",
      activeForEmail: null,
      tokenHash: null,
    },
  });
  return result.count;
}

export async function createAccountInvitation(
  input: CreateAccountInvitationInput,
): Promise<AccountInvitationGrant> {
  const normalizedEmail = normalizeAccountEmail(input.email);
  if (!isValidAccountEmail(input.email)) {
    throw new AccountAdmissionError(400, "invalid_email", "Enter a valid email address.");
  }

  const token = createOpaqueToken();
  const tokenHash = hashOpaqueToken(token);
  const now = new Date();
  const expiresAt = invitationExpiry(now, input.expiresAt);

  try {
    const result = await runSerializableTransaction(async (tx) => {
      await tx.accountInvitation.updateMany({
        where: {
          activeForEmail: normalizedEmail,
          status: "PENDING",
          expiresAt: { lte: now },
        },
        data: {
          status: "EXPIRED",
          activeForEmail: null,
          tokenHash: null,
        },
      });

      const existingUser = await tx.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true },
      });
      if (existingUser) {
        throw new AccountAdmissionError(
          409,
          "already_member",
          "A ReadWise account already exists for this email.",
        );
      }

      const active = await tx.accountInvitation.findUnique({
        where: { activeForEmail: normalizedEmail },
        select: { id: true },
      });
      if (active) {
        throw new AccountAdmissionError(
          409,
          "invitation_exists",
          "An active invitation already exists for this email.",
        );
      }

      const invitation = await tx.accountInvitation.create({
        data: {
          email: input.email.trim(),
          normalizedEmail,
          activeForEmail: normalizedEmail,
          tokenHash,
          invitedById: input.invitedById,
          expiresAt,
        },
      });
      const delivery = await queueAccountInvitationEmail(tx, {
        email: invitation.email,
        token,
        expiresAt: invitation.expiresAt,
        invitationId: invitation.id,
        invitationTokenHash: tokenHash,
      });
      return { invitation, delivery };
    });
    return { ...result, token };
  } catch (error) {
    if (isUniqueConflict(error)) {
      throw new AccountAdmissionError(
        409,
        "invitation_exists",
        "An active invitation already exists for this email.",
      );
    }
    throw error;
  }
}

export async function inspectAccountInvitation(
  token: string,
  now = new Date(),
): Promise<PublicInvitationView> {
  const tokenHash = hashOpaqueToken(token);
  const invitation = await prisma.accountInvitation.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      email: true,
      status: true,
      expiresAt: true,
    },
  });

  if (!invitation) {
    return { id: "", status: "invalid", maskedEmail: null, expiresAt: null };
  }

  if (invitation.status === "PENDING" && invitation.expiresAt <= now) {
    await prisma.accountInvitation.updateMany({
      where: { id: invitation.id, status: "PENDING", tokenHash },
      data: {
        status: "EXPIRED",
        activeForEmail: null,
        tokenHash: null,
      },
    });
    return {
      id: invitation.id,
      status: "expired",
      maskedEmail: maskEmail(invitation.email),
      expiresAt: invitation.expiresAt,
    };
  }

  return {
    id: invitation.id,
    status: invitation.status.toLowerCase() as PublicInvitationView["status"],
    maskedEmail: maskEmail(invitation.email),
    expiresAt: invitation.expiresAt,
  };
}

export async function revokeAccountInvitation(
  id: string,
): Promise<AccountInvitation> {
  const now = new Date();
  const invitation = await prisma.accountInvitation.findUnique({
    where: { id },
  });
  if (!invitation) {
    throw new AccountAdmissionError(404, "not_found", "Invitation not found.");
  }
  if (invitation.status === "REVOKED") {
    return invitation;
  }
  if (invitation.status !== "PENDING") {
    throw new AccountAdmissionError(
      409,
      "invalid_transition",
      "Only a pending invitation can be revoked.",
    );
  }
  if (invitation.expiresAt <= now) {
    await prisma.accountInvitation.updateMany({
      where: { id, status: "PENDING", expiresAt: { lte: now } },
      data: {
        status: "EXPIRED",
        activeForEmail: null,
        tokenHash: null,
      },
    });
    throw new AccountAdmissionError(
      409,
      "invalid_transition",
      "An expired invitation cannot be revoked.",
    );
  }
  const revoked = await prisma.accountInvitation.updateMany({
    where: {
      id,
      status: "PENDING",
      expiresAt: { gt: now },
    },
    data: {
      status: "REVOKED",
      revokedAt: new Date(),
      activeForEmail: null,
      tokenHash: null,
    },
  });
  if (revoked.count !== 1) {
    throw new AccountAdmissionError(
      409,
      "claim_conflict",
      "The invitation changed before it could be revoked.",
    );
  }
  const updated = await prisma.accountInvitation.findUnique({ where: { id } });
  if (!updated) {
    throw new AccountAdmissionError(404, "not_found", "Invitation not found.");
  }
  return updated;
}

export async function rotateAccountInvitation(
  id: string,
  expiresAt?: Date,
): Promise<AccountInvitationGrant> {
  const token = createOpaqueToken();
  const tokenHash = hashOpaqueToken(token);
  const now = new Date();
  const nextExpiry = invitationExpiry(now, expiresAt);

  const result = await runSerializableTransaction(async (tx) => {
    const invitation = await tx.accountInvitation.findUnique({ where: { id } });
    if (!invitation) {
      throw new AccountAdmissionError(404, "not_found", "Invitation not found.");
    }
    if (invitation.status !== "PENDING" || invitation.expiresAt <= now) {
      throw new AccountAdmissionError(
        409,
        "invalid_transition",
        "Only a pending invitation can be rotated.",
      );
    }

    const rotated = await tx.accountInvitation.updateMany({
      where: {
        id,
        status: "PENDING",
        expiresAt: { gt: now },
      },
      data: { tokenHash, expiresAt: nextExpiry },
    });
    if (rotated.count !== 1) {
      throw new AccountAdmissionError(
        409,
        "claim_conflict",
        "The invitation changed before its link could be rotated.",
      );
    }
    const updated = await tx.accountInvitation.findUnique({ where: { id } });
    if (!updated) {
      throw new AccountAdmissionError(404, "not_found", "Invitation not found.");
    }
    const delivery = await queueAccountInvitationEmail(tx, {
      email: updated.email,
      token,
      expiresAt: updated.expiresAt,
      invitationId: updated.id,
      invitationTokenHash: tokenHash,
    });
    return { invitation: updated, delivery };
  });
  return { ...result, token };
}

export async function listAccountInvitations() {
  await expirePendingInvitations();
  return prisma.accountInvitation.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      status: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      createdAt: true,
      invitedBy: {
        select: { id: true, name: true },
      },
      acceptedBy: {
        select: { id: true, name: true },
      },
    },
  });
}
