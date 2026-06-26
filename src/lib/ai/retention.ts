/**
 * AI invocation ledger retention and erasure (RW-019 / #712-A).
 *
 * Mirrors the analytics retention pattern (REF-049):
 *   - {@link pruneOldAiInvocations} — time-based retention window (scheduled job/CLI).
 *   - {@link deleteAiInvocationsForUser} — explicit per-user GDPR/privacy erasure.
 *
 * Because `userId` is a plain string (NOT an FK), records do NOT cascade with
 * user deletion — call {@link deleteAiInvocationsForUser} explicitly when erasing
 * a user's data.
 *
 * Neither helper runs automatically. Wire them to a scheduled task or
 * maintenance script; they do NOT affect normal traffic paths.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { aiLedgerRetentionDays } from "@/lib/runtime-config/ai";

export type AiInvocationRetentionClient = Pick<Prisma.TransactionClient, "aiInvocation">;

/**
 * Deletes AI invocation records older than the retention window (#712-A).
 * `olderThanDays` defaults to {@link aiLedgerRetentionDays} (env:
 * `AI_LEDGER_RETENTION_DAYS`, default 365). Returns the number of rows removed.
 * Intended to be run from a scheduled job or CLI maintenance script.
 */
export async function pruneOldAiInvocations(
  olderThanDays: number = aiLedgerRetentionDays(),
  client: AiInvocationRetentionClient = prisma,
  now: Date = new Date(),
): Promise<number> {
  const days =
    Number.isFinite(olderThanDays) && olderThanDays > 0
      ? Math.floor(olderThanDays)
      : aiLedgerRetentionDays();
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const result = await client.aiInvocation.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return result.count;
}

/**
 * Deletes ALL AI invocation records for a user (GDPR/privacy erasure, #712-A).
 * Because `userId` is a plain string (not an FK), records do NOT cascade with
 * the user row — call this explicitly when erasing a user's data. Returns the
 * number of rows removed.
 */
export async function deleteAiInvocationsForUser(
  userId: string,
  client: AiInvocationRetentionClient = prisma,
): Promise<number> {
  if (!userId) return 0;
  const result = await client.aiInvocation.deleteMany({ where: { userId } });
  return result.count;
}
