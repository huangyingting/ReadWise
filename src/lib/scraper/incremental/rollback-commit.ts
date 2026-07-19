/**
 * Active→shadow rollback commit for a discovery source (issue #1097, Phase 2.7).
 *
 * This is the thin persistence op behind the admin `rollback` lifecycle action
 * when a source is ACTIVE. In ONE guarded transaction it:
 *   1. Transitions ACTIVE → SHADOW and PARKS scheduling (`nextRunAt = null`) so
 *      the discovery loop stops picking the source up — no new candidate ingest
 *      work is enqueued (SHADOW discovery is observe-only regardless).
 *   2. INCREMENTS `activationGeneration` so a body-fetch job whose pre-rollback
 *      generation snapshot predates this rollback fails closed at Article commit
 *      (via `revalidateSourceGeneration`) even after a LATER re-activation.
 *   3. Cancels the source's UNCLAIMED (PENDING) candidate ingest jobs
 *      (→ DEAD_LETTER, controlled reason). A concurrently-claimed/running job is
 *      NOT cancelled — it fails closed at commit via the generation guard.
 *
 * Candidates and observations are PRESERVED (never deleted or reset), so a later
 * explicit `activate` can deterministically requeue eligible shadow candidates.
 *
 * House-style guarded concurrency: the read happens before the transaction; the
 * single interactive `$transaction` re-validates lease/`definitionVersion`/mode
 * via a guarded `updateMany({ where: { id, lifecycleMode: ACTIVE, ... } })`. A
 * zero-row update (a worker claimed the source, the definition changed, or a
 * concurrent rollback won) rolls the whole write back so it can never
 * double-apply. PRIVACY: only ids, modes, counts, and a reason code — never a
 * URL or article content.
 */
import { CrawlCandidateStatus, DiscoverySourceLifecycleMode } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/observability/logger";
import { cancelPendingCandidateIngestJobsInTx } from "@/lib/jobs";

const log = createLogger("discovery-rollback");

const M = DiscoverySourceLifecycleMode;

/** Why a rollback did not persist (sanitized category — never a URL/body). */
export type RollbackFailure = "source-not-found" | "busy" | "invalid-transition" | "lease-lost";

/** Outcome of an active→shadow rollback. */
export type RollbackActiveResult =
  | { committed: false; reason: RollbackFailure }
  | {
      committed: true;
      fromMode: DiscoverySourceLifecycleMode;
      toMode: DiscoverySourceLifecycleMode;
      /** PENDING candidate ingest jobs cancelled by this rollback. */
      cancelledJobCount: number;
      /** The source's activation generation AFTER the increment. */
      activationGeneration: number;
    };

/** Rolls the whole transaction back on a lost/stolen lease or concurrent change. */
class RollbackConflictError extends Error {
  constructor() {
    super("discovery source lease/version/mode changed during rollback");
    this.name = "RollbackConflictError";
  }
}

/**
 * Rolls an ACTIVE source back to SHADOW (see the module doc for the full,
 * atomic effect). Returns a typed failure for a missing/busy source or a
 * non-ACTIVE mode; the admin dispatcher maps these to HTTP statuses and audits
 * the successful mutation.
 */
export async function rollbackActiveToShadow(
  sourceId: string,
  now: Date = new Date(),
): Promise<RollbackActiveResult> {
  const source = await prisma.discoverySource.findUnique({
    where: { id: sourceId },
    select: { lifecycleMode: true, leaseOwner: true, definitionVersion: true },
  });
  if (!source) return { committed: false, reason: "source-not-found" };
  // A worker holds the discovery lease: refuse rather than race a live page run.
  if (source.leaseOwner !== null) return { committed: false, reason: "busy" };
  if (source.lifecycleMode !== M.ACTIVE) return { committed: false, reason: "invalid-transition" };

  try {
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.discoverySource.updateMany({
        where: {
          id: sourceId,
          lifecycleMode: M.ACTIVE,
          leaseOwner: null,
          definitionVersion: source.definitionVersion,
        },
        data: {
          lifecycleMode: M.SHADOW,
          // Park scheduling: stop the discovery loop from claiming the source
          // until an operator explicitly re-activates (which re-sets nextRunAt).
          nextRunAt: null,
          // Bump the generation marker so pre-rollback in-flight work fails
          // closed at Article commit even across a later re-activation.
          activationGeneration: { increment: 1 },
          updatedAt: now,
        },
      });
      if (updated.count === 0) throw new RollbackConflictError();

      // Cancel the source's UNCLAIMED candidate ingest jobs. Candidates +
      // observations are preserved; only PENDING jobs are made terminal.
      const candidates = await tx.crawlCandidate.findMany({
        where: {
          discoverySourceId: sourceId,
          status: { in: [CrawlCandidateStatus.DISCOVERED, CrawlCandidateStatus.QUEUED] },
        },
        select: { id: true },
      });
      const cancelledJobCount = await cancelPendingCandidateIngestJobsInTx(
        tx,
        candidates.map((c) => c.id),
        now,
      );

      const after = await tx.discoverySource.findUnique({
        where: { id: sourceId },
        select: { activationGeneration: true },
      });

      return {
        committed: true as const,
        fromMode: M.ACTIVE,
        toMode: M.SHADOW,
        cancelledJobCount,
        activationGeneration: after?.activationGeneration ?? 0,
      };
    });
  } catch (error) {
    if (error instanceof RollbackConflictError) return { committed: false, reason: "lease-lost" };
    throw error;
  } finally {
    log.info("discovery source rollback (active→shadow) attempted", { sourceId });
  }
}
