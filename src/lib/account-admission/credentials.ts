import { prisma } from "@/lib/prisma";
import { runSerializableTransaction } from "@/lib/database/serializable-transaction";
import { AccountAdmissionError } from "./errors";
import { queuePasswordResetEmail } from "./email";
import { createDatabaseSession } from "./session";
import { normalizeAccountEmail } from "./policy";
import { hashPassword, verifyPassword } from "./passwords";
import { createOpaqueToken, hashOpaqueToken } from "./tokens";

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const DUMMY_PASSWORD_HASH =
  "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function authenticatePassword(input: {
  email: string;
  password: string;
}) {
  const normalizedEmail = normalizeAccountEmail(input.email);
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    include: { passwordCredential: true },
  });
  const encoded = user?.passwordCredential?.passwordHash ?? DUMMY_PASSWORD_HASH;

  const valid = await verifyPassword(
    input.password,
    encoded,
  );
  if (!valid || !user?.passwordCredential) return null;

  const session = await createDatabaseSession(prisma, user.id);
  return { user, session };
}

export async function requestPasswordReset(email: string) {
  const normalizedEmail = normalizeAccountEmail(email);
  const token = createOpaqueToken();
  const tokenHash = hashOpaqueToken(token);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
  return runSerializableTransaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        email: true,
        passwordCredential: { select: { id: true } },
      },
    });
    if (!user?.email || !user.passwordCredential) return null;

    await tx.passwordCredential.update({
      where: { userId: user.id },
      data: {
        resetTokenHash: tokenHash,
        resetExpiresAt: expiresAt,
      },
    });
    const delivery = await queuePasswordResetEmail(tx, {
      email: user.email,
      token,
      expiresAt,
      passwordResetHash: tokenHash,
    });
    if (!delivery.queued) {
      throw new AccountAdmissionError(
        503,
        "email_unavailable",
        "Password recovery email delivery is unavailable.",
      );
    }
    return { token, email: user.email, expiresAt };
  });
}

export async function resetPassword(input: {
  token: string;
  password: string;
}) {
  const tokenHash = hashOpaqueToken(input.token);
  const passwordHash = await hashPassword(input.password);
  const now = new Date();

  const outcome = await runSerializableTransaction(async (tx) => {
    const credential = await tx.passwordCredential.findUnique({
      where: { resetTokenHash: tokenHash },
      select: { id: true, userId: true, resetExpiresAt: true },
    });
    if (!credential) return { error: "invalid" as const };
    if (!credential.resetExpiresAt || credential.resetExpiresAt <= now) {
      await tx.passwordCredential.update({
        where: { id: credential.id },
        data: { resetTokenHash: null, resetExpiresAt: null },
      });
      return { error: "expired" as const };
    }

    await tx.passwordCredential.update({
      where: { id: credential.id },
      data: {
        passwordHash,
        passwordChangedAt: now,
        resetTokenHash: null,
        resetExpiresAt: null,
      },
    });
    await tx.session.deleteMany({ where: { userId: credential.userId } });
    return { userId: credential.userId };
  });

  if ("error" in outcome) {
    throw new AccountAdmissionError(
      410,
      outcome.error === "expired" ? "expired" : "invalid_reset",
      outcome.error === "expired"
        ? "This password reset link has expired."
        : "This password reset link is invalid or no longer active.",
    );
  }
  return outcome;
}

export async function setPasswordForUser(input: {
  userId: string;
  currentPassword?: string;
  password: string;
}) {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      email: true,
      emailVerified: true,
      passwordCredential: {
        select: { id: true, passwordHash: true },
      },
    },
  });
  if (!user?.email) {
    throw new AccountAdmissionError(
      400,
      "email_required",
      "An email address is required before adding a password.",
    );
  }

  if (user.passwordCredential) {
    const currentValid =
      typeof input.currentPassword === "string" &&
      await verifyPassword(
        input.currentPassword,
        user.passwordCredential.passwordHash,
      );
    if (!currentValid) {
      throw new AccountAdmissionError(
        403,
        "current_password_invalid",
        "The current password is incorrect.",
      );
    }
  }

  const passwordHash = await hashPassword(input.password);
  const now = new Date();
  await prisma.$transaction([
    user.passwordCredential
      ? prisma.passwordCredential.update({
          where: { id: user.passwordCredential.id },
          data: {
            passwordHash,
            passwordChangedAt: now,
            resetTokenHash: null,
            resetExpiresAt: null,
          },
        })
      : prisma.passwordCredential.create({
          data: {
            userId: user.id,
            passwordHash,
            passwordChangedAt: now,
          },
        }),
    prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: user.emailVerified ?? now },
    }),
  ]);
  return { userId: user.id, created: !user.passwordCredential };
}

export async function listAuthenticationMethods(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      passwordCredential: { select: { id: true } },
      accounts: {
        orderBy: { provider: "asc" },
        select: { provider: true, type: true },
      },
    },
  });
  if (!user) {
    throw new AccountAdmissionError(404, "not_found", "Account not found.");
  }
  return {
    hasPassword: user.passwordCredential !== null,
    providers: user.accounts.map((account) => account.provider),
  };
}
