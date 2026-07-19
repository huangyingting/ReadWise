/**
 * Leased DiscoverySource claiming (issue #1087, Phase 1.7).
 *
 * Public claim API — mirrors `src/lib/jobs/claim.ts`: dispatches to the
 * PostgreSQL or generic adapter based on the active database URL so a due,
 * eligible discovery source is claimed by AT MOST one worker at a time. The
 * `leaseOwner` / `leaseAcquiredAt` / `leaseExpiresAt` columns are the
 * single-writer coordination for a source; the page/frontier commits
 * (`page-commit.ts` / `frontier-commit.ts`) enforce that ownership again on
 * every write, so two workers can never run one source/version concurrently.
 *
 * `leaseOwner` is an OPAQUE worker token — never a secret or credential.
 */
import type { DiscoverySource, Prisma } from "@prisma/client";

import { isPostgresDatabase } from "@/lib/db-utils";

import { AUTO_CLAIM_POLICIES, CLAIMABLE_LIFECYCLE_MODES } from "./schedule";
import { claimDueDiscoverySourcePostgres } from "./discovery-claim-postgres";
import { claimDueDiscoverySourceGeneric } from "./discovery-claim-generic";

/** Default discovery lease length (ms). A lease older than this is stale. */
export const DEFAULT_DISCOVERY_LEASE_TTL_MS = 5 * 60 * 1000;

export type ClaimDiscoveryOptions = {
  /** Lease length (ms). An expired lease is reclaimable (crashed-worker recovery). */
  lockTtlMs?: number;
  /** Override "now" (testing / determinism). */
  now?: Date;
};

/** A claimed source plus whether the claim reclaimed a crashed worker's stale lease. */
export type ClaimedDiscoverySource = {
  source: DiscoverySource;
  wasStale: boolean;
};

/**
 * The eligibility predicate for a due discovery source, shared by BOTH claim
 * adapters (the generic path uses it directly; the PostgreSQL path mirrors it in
 * SQL). A source is claimable when it is due (`nextRunAt <= now`), in a
 * claimable lifecycle mode, under an auto-claim automation policy, its lease is
 * free OR expired (stale-lease reclaim), and it is not inside an active backoff.
 */
export function buildDueDiscoverySourceWhere(now: Date): Prisma.DiscoverySourceWhereInput {
  return {
    nextRunAt: { lte: now },
    lifecycleMode: { in: [...CLAIMABLE_LIFECYCLE_MODES] },
    automationPolicy: { in: [...AUTO_CLAIM_POLICIES] },
    AND: [
      { OR: [{ leaseOwner: null }, { leaseExpiresAt: { lt: now } }] },
      { OR: [{ backoffUntil: null }, { backoffUntil: { lte: now } }] },
    ],
  };
}

/**
 * Atomically claims one due discovery source for `workerId`, stamping a fresh
 * lease. Returns `null` when nothing is due/eligible. Safe under concurrency:
 * PostgreSQL uses `FOR UPDATE SKIP LOCKED`; other providers use a serialized
 * transaction with a guarded conditional update. An expired lease is reclaimed
 * so a crashed worker never strands a source.
 */
export async function claimDueDiscoverySource(
  workerId: string,
  opts: ClaimDiscoveryOptions = {},
): Promise<ClaimedDiscoverySource | null> {
  const now = opts.now ?? new Date();
  const lockTtlMs = opts.lockTtlMs ?? DEFAULT_DISCOVERY_LEASE_TTL_MS;
  const leaseExpiresAt = new Date(now.getTime() + lockTtlMs);

  return isPostgresDatabase()
    ? claimDueDiscoverySourcePostgres(workerId, now, leaseExpiresAt)
    : claimDueDiscoverySourceGeneric(workerId, now, leaseExpiresAt);
}
