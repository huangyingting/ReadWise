/**
 * Generic (SQLite / non-PostgreSQL) DiscoverySource claim adapter (issue #1087,
 * Phase 1.7).
 *
 * Serialized transaction with a guarded conditional update — the same pattern as
 * `src/lib/jobs/claim-generic.ts`. The guarded `updateMany` (whose `where`
 * re-asserts the full due/eligible predicate) ensures two transactions that read
 * the same candidate cannot both win the claim. An expired lease is reclaimed
 * identically to the PostgreSQL adapter.
 */
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/observability/logger";

import { buildDueDiscoverySourceWhere, type ClaimedDiscoverySource } from "./discovery-claim";

const log = createLogger("scraper");

/** True when the candidate's current lease had already expired (crashed worker). */
function isStaleLease(leaseOwner: string | null, leaseExpiresAt: Date | null, now: Date): boolean {
  return leaseOwner !== null && leaseExpiresAt !== null && leaseExpiresAt < now;
}

export async function claimDueDiscoverySourceGeneric(
  workerId: string,
  now: Date,
  leaseExpiresAt: Date,
): Promise<ClaimedDiscoverySource | null> {
  const where = buildDueDiscoverySourceWhere(now);

  return prisma.$transaction(async (tx) => {
    const candidate = await tx.discoverySource.findFirst({
      where,
      orderBy: [{ nextRunAt: "asc" }, { createdAt: "asc" }],
    });
    if (!candidate) return null;

    // Guarded update: only succeeds while the row still satisfies the predicate,
    // so two transactions that read the same candidate cannot both win.
    const claimed = await tx.discoverySource.updateMany({
      where: { id: candidate.id, ...where },
      data: {
        leaseOwner: workerId,
        leaseAcquiredAt: now,
        leaseExpiresAt,
        updatedAt: now,
      },
    });
    if (claimed.count === 0) return null;

    const wasStale = isStaleLease(candidate.leaseOwner, candidate.leaseExpiresAt, now);
    if (wasStale) {
      log.warn("recovered stale discovery-source lease", {
        sourceId: candidate.id,
        definitionVersion: candidate.definitionVersion,
      });
    }

    const source = await tx.discoverySource.findUnique({ where: { id: candidate.id } });
    return source ? { source, wasStale } : null;
  });
}
