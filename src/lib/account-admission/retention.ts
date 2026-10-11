import { AccountInvitationStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { accountAdmissionRetentionDays } from "@/lib/runtime-config/account-admission";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type RetentionClient = Pick<
  Prisma.TransactionClient,
  | "accountEmailOutbox"
  | "accountInvitation"
  | "pendingRegistration"
  | "passwordCredential"
>;

function terminalInvitationCutoff(days: number, now: Date): Date {
  const retentionDays =
    Number.isFinite(days) && days > 0
      ? Math.floor(days)
      : accountAdmissionRetentionDays();
  return new Date(now.getTime() - retentionDays * MS_PER_DAY);
}

function terminalInvitationWhere(days: number, now: Date) {
  return {
    status: {
      in: [
        AccountInvitationStatus.ACCEPTED,
        AccountInvitationStatus.REVOKED,
        AccountInvitationStatus.EXPIRED,
      ],
    },
    updatedAt: { lt: terminalInvitationCutoff(days, now) },
  };
}

function expiredOutboxWhere(now: Date) {
  return {
    OR: [
      {
        status: "pending",
        expiresAt: { lte: now },
      },
      {
        status: { notIn: ["pending", "sending"] },
        OR: [
          { expiresAt: { lte: now } },
          {
            createdAt: {
              lt: new Date(now.getTime() - 7 * MS_PER_DAY),
            },
          },
        ],
      },
    ],
  };
}

export async function countExpiredAccountAdmissionData(
  invitationRetentionDays = accountAdmissionRetentionDays(),
  client: RetentionClient = prisma,
  now = new Date(),
): Promise<number> {
  const [queuedEmails, pendingRegistrations, terminalInvitations, resetTokens] =
    await Promise.all([
      client.accountEmailOutbox.count({
        where: expiredOutboxWhere(now),
      }),
      client.pendingRegistration.count({
        where: { expiresAt: { lte: now } },
      }),
      client.accountInvitation.count({
        where: terminalInvitationWhere(invitationRetentionDays, now),
      }),
      client.passwordCredential.count({
        where: {
          resetTokenHash: { not: null },
          resetExpiresAt: { lte: now },
        },
      }),
    ]);
  return queuedEmails + pendingRegistrations + terminalInvitations + resetTokens;
}

export async function pruneExpiredAccountAdmissionData(
  invitationRetentionDays = accountAdmissionRetentionDays(),
  client: RetentionClient = prisma,
  now = new Date(),
): Promise<number> {
  const [queuedEmails, pendingRegistrations, terminalInvitations, resetTokens] =
    await Promise.all([
      client.accountEmailOutbox.deleteMany({
        where: expiredOutboxWhere(now),
      }),
      client.pendingRegistration.deleteMany({
        where: { expiresAt: { lte: now } },
      }),
      client.accountInvitation.deleteMany({
        where: terminalInvitationWhere(invitationRetentionDays, now),
      }),
      client.passwordCredential.updateMany({
        where: {
          resetTokenHash: { not: null },
          resetExpiresAt: { lte: now },
        },
        data: {
          resetTokenHash: null,
          resetExpiresAt: null,
        },
      }),
    ]);
  return (
    queuedEmails.count +
    pendingRegistrations.count +
    terminalInvitations.count +
    resetTokens.count
  );
}
