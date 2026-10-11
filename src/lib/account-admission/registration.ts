import { prisma } from "@/lib/prisma";
import { runSerializableTransaction } from "@/lib/database/serializable-transaction";
import { AccountAdmissionError } from "./errors";
import { hashPassword } from "./passwords";
import {
  accountAdmissionMode,
  isValidAccountEmail,
  normalizeAccountEmail,
} from "./policy";
import { createDatabaseSession } from "./session";
import { createOpaqueToken, hashOpaqueToken } from "./tokens";
import { AUDIT_ACTIONS, recordAuditLog } from "@/lib/security/audit";

const PUBLIC_REGISTRATION_TTL_MS = 24 * 60 * 60 * 1000;

export type RegistrationInput = {
  email: string;
  password: string;
  name?: string | null;
};

export type InvitationRegistrationInput = RegistrationInput & {
  token: string;
};

function normalizedName(name: string | null | undefined): string | null {
  const value = name?.trim();
  return value ? value.slice(0, 120) : null;
}

function registrationEmail(email: string): string {
  if (!isValidAccountEmail(email)) {
    throw new AccountAdmissionError(
      400,
      "invalid_email",
      "Enter a valid email address.",
    );
  }
  return normalizeAccountEmail(email);
}

export async function registerWithInvitation(
  input: InvitationRegistrationInput,
) {
  if (accountAdmissionMode() !== "invitation-only") {
    throw new AccountAdmissionError(
      409,
      "mode_mismatch",
      "Invitation registration is not enabled.",
    );
  }

  const normalizedEmail = registrationEmail(input.email);
  const tokenHash = hashOpaqueToken(input.token);
  const passwordHash = await hashPassword(input.password);
  const now = new Date();

  const outcome = await runSerializableTransaction(async (tx) => {
    const invitation = await tx.accountInvitation.findUnique({
      where: { tokenHash },
    });
    if (!invitation || invitation.status !== "PENDING") {
      return { error: "invalid" as const };
    }
    if (invitation.expiresAt <= now) {
      await tx.accountInvitation.update({
        where: { id: invitation.id },
        data: {
          status: "EXPIRED",
          activeForEmail: null,
          tokenHash: null,
        },
      });
      return { error: "expired" as const };
    }
    if (invitation.normalizedEmail !== normalizedEmail) {
      throw new AccountAdmissionError(
        403,
        "email_mismatch",
        "The invitation does not match this email address.",
      );
    }

    const existing = await tx.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    if (existing) {
      throw new AccountAdmissionError(
        409,
        "already_member",
        "A ReadWise account already exists for this email.",
      );
    }

    const user = await tx.user.create({
      data: {
        email: normalizedEmail,
        emailVerified: now,
        name: normalizedName(input.name),
        role: "Reader",
        passwordCredential: {
          create: { passwordHash, passwordChangedAt: now },
        },
      },
    });

    const claimed = await tx.accountInvitation.updateMany({
      where: {
        id: invitation.id,
        tokenHash,
        status: "PENDING",
        expiresAt: { gt: now },
      },
      data: {
        status: "ACCEPTED",
        acceptedById: user.id,
        acceptedAt: now,
        activeForEmail: null,
        tokenHash: null,
      },
    });
    if (claimed.count !== 1) {
      throw new AccountAdmissionError(
        409,
        "claim_conflict",
        "This invitation has already been claimed.",
      );
    }

    await recordAuditLog(
      {
        action: AUDIT_ACTIONS.accountInvitationAccept,
        actorId: user.id,
        actorRole: user.role,
        targetType: "account_invitation",
        targetId: invitation.id,
        metadata: { status: "ACCEPTED" },
      },
      tx,
    );
    const session = await createDatabaseSession(tx, user.id, now);
    return { user, session };
  });

  if ("error" in outcome) {
    throw new AccountAdmissionError(
      410,
      outcome.error === "expired" ? "expired" : "invalid_invitation",
      outcome.error === "expired"
        ? "This invitation has expired."
        : "This invitation is invalid or no longer active.",
    );
  }
  return outcome;
}

export async function beginPublicRegistration(input: RegistrationInput) {
  if (accountAdmissionMode() !== "public") {
    throw new AccountAdmissionError(
      403,
      "invitation_required",
      "An invitation is required to create an account.",
    );
  }

  const normalizedEmail = registrationEmail(input.email);
  const passwordHash = await hashPassword(input.password);
  const token = createOpaqueToken();
  const tokenHash = hashOpaqueToken(token);
  const expiresAt = new Date(Date.now() + PUBLIC_REGISTRATION_TTL_MS);

  const existing = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });
  if (existing) {
    return { token: null, email: null, expiresAt };
  }

  await prisma.pendingRegistration.upsert({
    where: { normalizedEmail },
    create: {
      email: input.email.trim(),
      normalizedEmail,
      name: normalizedName(input.name),
      passwordHash,
      tokenHash,
      expiresAt,
    },
    update: {
      email: input.email.trim(),
      name: normalizedName(input.name),
      passwordHash,
      tokenHash,
      expiresAt,
    },
  });

  return { token, email: normalizedEmail, expiresAt };
}

export async function completePublicRegistration(token: string) {
  if (accountAdmissionMode() !== "public") {
    throw new AccountAdmissionError(
      403,
      "registration_closed",
      "Public registration is not enabled.",
    );
  }

  const tokenHash = hashOpaqueToken(token);
  const now = new Date();
  const outcome = await runSerializableTransaction(async (tx) => {
    const pending = await tx.pendingRegistration.findUnique({
      where: { tokenHash },
    });
    if (!pending) return { error: "invalid" as const };
    if (pending.expiresAt <= now) {
      await tx.pendingRegistration.delete({ where: { id: pending.id } });
      return { error: "expired" as const };
    }

    const existing = await tx.user.findUnique({
      where: { email: pending.normalizedEmail },
      select: { id: true },
    });
    if (existing) {
      await tx.pendingRegistration.delete({ where: { id: pending.id } });
      return { error: "exists" as const };
    }

    const user = await tx.user.create({
      data: {
        email: pending.normalizedEmail,
        emailVerified: now,
        name: pending.name,
        role: "Reader",
        passwordCredential: {
          create: {
            passwordHash: pending.passwordHash,
            passwordChangedAt: now,
          },
        },
      },
    });
    await tx.pendingRegistration.delete({ where: { id: pending.id } });
    const session = await createDatabaseSession(tx, user.id, now);
    return { user, session };
  });

  if ("error" in outcome) {
    throw new AccountAdmissionError(
      outcome.error === "exists" ? 409 : 410,
      outcome.error === "expired" ? "expired" : "invalid_registration",
      outcome.error === "expired"
        ? "This verification link has expired."
        : "This verification link is invalid or no longer active.",
    );
  }
  return outcome;
}
