import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { accountMailWorkflowConfig } from "@/lib/runtime-config/account-admission";

const CLAIM_LIMIT = 10;
const CLAIM_TIMEOUT_MS = 15 * 60 * 1000;
const TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type AccountMailBase = {
  to: string;
  subject: string;
  body: string;
};

type InvitationMail = AccountMailBase & {
  invitationId: string;
  invitationTokenHash: string;
};

type PasswordResetMail = AccountMailBase & {
  passwordResetHash: string;
};

type RegistrationMail = AccountMailBase & {
  registrationHash: string;
};

export type AccountMail =
  | InvitationMail
  | PasswordResetMail
  | RegistrationMail;

export type ClaimedAccountMail = AccountMail & {
  id: string;
  claimToken: string;
};

type QueueClient = Pick<Prisma.TransactionClient, "accountEmailOutbox">;

function mailKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is required for account mail");
  }
  return createHash("sha256")
    .update(`readwise-account-mail:${secret}`)
    .digest();
}

function hasText(
  value: unknown,
  maxLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength
  );
}

function isAccountMail(value: unknown): value is AccountMail {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  if (
    !hasText(message.to, 320) ||
    !hasText(message.subject, 200) ||
    !hasText(message.body, 20_000)
  ) {
    return false;
  }

  const invitation =
    hasText(message.invitationId, 128) &&
    hasText(message.invitationTokenHash, 128);
  const passwordReset = hasText(message.passwordResetHash, 128);
  const registration = hasText(message.registrationHash, 128);
  return [invitation, passwordReset, registration].filter(Boolean).length === 1;
}

export function encryptAccountMail(message: AccountMail): string {
  if (!isAccountMail(message)) {
    throw new Error("Invalid account mail payload");
  }
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", mailKey(), nonce);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(message), "utf8"),
    cipher.final(),
  ]);
  return [nonce, cipher.getAuthTag(), encrypted]
    .map((value) => value.toString("base64url"))
    .join(".");
}

export function decryptAccountMail(payload: string): AccountMail {
  const parts = payload.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid account mail payload");
  }
  const [nonce, tag, encrypted] = parts.map((value) =>
    Buffer.from(value, "base64url"),
  );
  const decipher = createDecipheriv("aes-256-gcm", mailKey(), nonce);
  decipher.setAuthTag(tag);
  const decoded: unknown = JSON.parse(
    Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8"),
  );
  if (!isAccountMail(decoded)) {
    throw new Error("Invalid account mail payload");
  }
  return decoded;
}

export async function queueAccountMail(
  tx: QueueClient,
  message: AccountMail,
  expiresAt: Date,
) {
  if (!accountMailWorkflowConfig.isConfigured()) {
    throw new Error("Account email delivery is not configured");
  }
  return tx.accountEmailOutbox.create({
    data: {
      payload: encryptAccountMail(message),
      expiresAt,
      invitationId:
        "invitationId" in message ? message.invitationId : null,
    },
  });
}

async function messageIsActive(message: AccountMail): Promise<boolean> {
  if ("invitationId" in message) {
    return Boolean(
      await prisma.accountInvitation.findFirst({
        where: {
          id: message.invitationId,
          tokenHash: message.invitationTokenHash,
          status: "PENDING",
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      }),
    );
  }
  if ("passwordResetHash" in message) {
    return Boolean(
      await prisma.passwordCredential.findFirst({
        where: {
          resetTokenHash: message.passwordResetHash,
          resetExpiresAt: { gt: new Date() },
        },
        select: { id: true },
      }),
    );
  }
  return Boolean(
    await prisma.pendingRegistration.findFirst({
      where: {
        tokenHash: message.registrationHash,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    }),
  );
}

async function failClaim(id: string, claimToken: string): Promise<void> {
  await prisma.accountEmailOutbox.updateMany({
    where: { id, claimToken, status: "sending" },
    data: {
      status: "failed",
      payload: "",
      claimToken: null,
      lastError: "Account link is no longer active.",
    },
  });
}

export async function claimAccountMail(
  now = new Date(),
): Promise<ClaimedAccountMail[]> {
  await prisma.accountEmailOutbox.deleteMany({
    where: {
      status: { notIn: ["pending", "sending"] },
      createdAt: {
        lt: new Date(now.getTime() - TERMINAL_RETENTION_MS),
      },
    },
  });
  await prisma.accountEmailOutbox.updateMany({
    where: {
      status: "sending",
      lastAttemptAt: {
        lte: new Date(now.getTime() - CLAIM_TIMEOUT_MS),
      },
    },
    data: {
      status: "unconfirmed",
      payload: "",
      claimToken: null,
      lastError: "Worker claim expired; delivery may have been accepted.",
    },
  });
  await prisma.accountEmailOutbox.updateMany({
    where: {
      status: "pending",
      expiresAt: { lte: now },
    },
    data: {
      status: "expired",
      payload: "",
      lastError: "Account link expired before delivery.",
    },
  });

  const candidates = await prisma.accountEmailOutbox.findMany({
    where: {
      status: "pending",
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "asc" },
    take: CLAIM_LIMIT,
    select: { id: true },
  });
  const claimed: ClaimedAccountMail[] = [];

  for (const candidate of candidates) {
    const claimToken = randomBytes(32).toString("hex");
    const updated = await prisma.accountEmailOutbox.updateMany({
      where: {
        id: candidate.id,
        status: "pending",
        expiresAt: { gt: now },
      },
      data: {
        status: "sending",
        claimToken,
        lastAttemptAt: now,
      },
    });
    if (updated.count !== 1) continue;

    const row = await prisma.accountEmailOutbox.findUnique({
      where: { id: candidate.id },
      select: { payload: true },
    });
    if (!row) continue;

    let message: AccountMail;
    try {
      message = decryptAccountMail(row.payload);
    } catch {
      await failClaim(candidate.id, claimToken);
      continue;
    }
    if (!(await messageIsActive(message))) {
      await failClaim(candidate.id, claimToken);
      continue;
    }
    claimed.push({
      id: candidate.id,
      claimToken,
      ...message,
    });
  }

  return claimed;
}

export async function acknowledgeAccountMail(
  id: string,
  claimToken: string,
  status: "sent" | "failed" | "unconfirmed",
): Promise<boolean> {
  const result = await prisma.accountEmailOutbox.updateMany({
    where: { id, claimToken, status: "sending" },
    data: {
      status,
      payload: "",
      claimToken: null,
      sentAt: status === "sent" ? new Date() : null,
      lastError:
        status === "sent"
          ? null
          : "Recipient delivery failed or could not be confirmed.",
    },
  });
  return result.count === 1;
}
