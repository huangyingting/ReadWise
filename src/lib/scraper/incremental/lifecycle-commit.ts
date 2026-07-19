/**
 * Thin, guarded persistence of discovery-source lifecycle transitions
 * (issue #1088, Phase 1.8).
 *
 * The lifecycle DECISIONS — which transitions are legal, whether a baseline may
 * complete, and which post-baseline shadow candidates to queue on activation —
 * are computed by the PURE `lifecycle.ts` module. This module ONLY applies those
 * decisions onto `DiscoverySource` (and, on activation, the source's shadow
 * candidates), reusing the #1085/#1086 guarded-persistence pattern:
 *
 *   - reads happen BEFORE the transaction; the single interactive
 *     `$transaction` re-reads + revalidates the lease/`definitionVersion` AND the
 *     expected current lifecycle mode, then advances state via a guarded
 *     `updateMany({ where: { id, leaseOwner, definitionVersion, lifecycleMode } })`.
 *     A zero-row update means the lease was lost/stolen or the source already
 *     transitioned concurrently → the whole write rolls back and NOTHING is
 *     persisted. This makes every transition atomic and idempotent-safe.
 *
 * Governing-invariant guards enforced here:
 *   - Activation is EXPLICIT and AUDITED: {@link activateDiscoverySource} stamps
 *     `activatedAt` (once) and logs a redacted, metadata-only decision entry.
 *   - A baseline can complete ONLY when the pure gate says every observable
 *     segment committed (a partial/failed baseline is refused).
 *   - On activation, ONLY eligible post-baseline shadow candidates (status
 *     `DISCOVERED`, `observedInBaseline = false`) within both catch-up limits are
 *     moved `DISCOVERED → QUEUED`; the move is guarded so a retry queues nothing
 *     new (deterministic + idempotent). Baseline observations are never touched.
 *   - NO Article is written, NO body is fetched, and NO ingest job is enqueued by
 *     any transition — lifecycle changes are pure state management.
 */
import {
  CrawlCandidateStatus,
  DiscoverySourceHealth,
  DiscoverySourceLifecycleMode,
  Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/observability/logger";

import type { CompoundWatermark } from "./frontier";
import {
  classifyLifecycleTransition,
  decideBaselineCompletion,
  selectActivationCatchUp,
  type BaselineSegmentState,
  type CatchUpLimits,
} from "./lifecycle";

const log = createLogger("discovery-lifecycle");

const M = DiscoverySourceLifecycleMode;

/** Common inputs for every guarded lifecycle commit. */
export type LifecycleCommitBase = {
  /** Target `DiscoverySource.id`. */
  sourceId: string;
  /**
   * Opaque worker lease token. Must still match `DiscoverySource.leaseOwner` on
   * the guarded update. A worker passes its held token; an admin lifecycle
   * action on an IDLE source passes `null`, so the guard applies only while the
   * source remains unclaimed (a worker claiming it concurrently aborts the write).
   */
  leaseOwner: string | null;
  /** Expected `DiscoverySource.definitionVersion`. Mismatch = a stale definition. */
  definitionVersion: number;
  /** Override "now" (testing / determinism). */
  now?: Date;
  /**
   * TEST-ONLY hook invoked INSIDE the transaction right before the guarded
   * update (mutating the source via `tx` proves a mid-commit lease/mode steal
   * aborts the write). Never set in production.
   */
  debugHooks?: { beforeUpdate?: (tx: Prisma.TransactionClient) => void | Promise<void> };
};

/** Why a lifecycle commit did not persist. */
export type LifecycleCommitFailure =
  | "source-not-found"
  | "lease-lost"
  | "invalid-transition"
  | "baseline-incomplete";

/** Rolls the whole transaction back on a lost/stolen lease or concurrent transition. */
class LeaseLostError extends Error {
  constructor() {
    super("discovery source lease/version/mode lost during lifecycle commit");
    this.name = "LeaseLostError";
  }
}

/**
 * Runs a guarded lifecycle update in ONE transaction: re-reads + revalidates the
 * lease/`definitionVersion` AND the expected current lifecycle mode, invokes an
 * optional in-tx `work` callback (e.g. queueing shadow candidates), then applies
 * the guarded `updateMany`. A zero-row guarded update (lease lost/stolen or the
 * source already transitioned) rolls everything back.
 */
async function runGuardedTransition(
  base: LifecycleCommitBase,
  expectedMode: DiscoverySourceLifecycleMode,
  data: Prisma.DiscoverySourceUpdateManyMutationInput,
  work?: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<boolean> {
  const { sourceId, leaseOwner, definitionVersion } = base;
  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.discoverySource.findUnique({
        where: { id: sourceId },
        select: { leaseOwner: true, definitionVersion: true, lifecycleMode: true },
      });
      if (
        !current ||
        current.leaseOwner !== leaseOwner ||
        current.definitionVersion !== definitionVersion ||
        current.lifecycleMode !== expectedMode
      ) {
        throw new LeaseLostError();
      }

      if (work) await work(tx);
      await base.debugHooks?.beforeUpdate?.(tx);

      const updated = await tx.discoverySource.updateMany({
        // Guard on the expected mode too, so a concurrent transition aborts.
        where: { id: sourceId, leaseOwner, definitionVersion, lifecycleMode: expectedMode },
        data,
      });
      if (updated.count === 0) throw new LeaseLostError();
    });
    return true;
  } catch (error) {
    if (error instanceof LeaseLostError) return false;
    throw error;
  }
}

/** Reads the fields every lifecycle commit needs, or a typed failure. */
async function loadSource(base: LifecycleCommitBase) {
  const source = await prisma.discoverySource.findUnique({
    where: { id: base.sourceId },
    select: {
      lifecycleMode: true,
      leaseOwner: true,
      definitionVersion: true,
      watermarkAt: true,
      watermarkKey: true,
      activatedAt: true,
    },
  });
  if (!source) return { ok: false as const, reason: "source-not-found" as const };
  if (source.leaseOwner !== base.leaseOwner || source.definitionVersion !== base.definitionVersion) {
    return { ok: false as const, reason: "lease-lost" as const };
  }
  return { ok: true as const, source };
}

// ---------------------------------------------------------------------------
// Begin baseline (DISABLED → BASELINE)
// ---------------------------------------------------------------------------

export type BeginBaselineResult =
  | { committed: false; reason: LifecycleCommitFailure }
  | { committed: true; mode: DiscoverySourceLifecycleMode };

/**
 * Starts a source's baseline (`DISABLED → BASELINE`): stamps `baselineStartedAt`,
 * clears any prior `baselineCompletedAt`, resets `baselineObservedCount`, and
 * marks the source due (`nextRunAt = now`) so the bounded discovery loop begins
 * the observable baseline pass. Records nothing about identities (that happens as
 * pages commit).
 */
export async function beginBaseline(base: LifecycleCommitBase): Promise<BeginBaselineResult> {
  const now = base.now ?? new Date();
  const loaded = await loadSource(base);
  if (!loaded.ok) return { committed: false, reason: loaded.reason };

  const from = loaded.source.lifecycleMode;
  if (classifyLifecycleTransition(from, M.BASELINE) !== "forward") {
    return { committed: false, reason: "invalid-transition" };
  }

  const data: Prisma.DiscoverySourceUpdateManyMutationInput = {
    lifecycleMode: M.BASELINE,
    baselineStartedAt: now,
    baselineCompletedAt: null,
    baselineObservedCount: 0,
    health: DiscoverySourceHealth.UNKNOWN,
    nextRunAt: now,
    updatedAt: now,
  };

  const ok = await runGuardedTransition(base, from, data);
  if (!ok) return { committed: false, reason: "lease-lost" };
  log.info("discovery baseline started", { sourceId: base.sourceId });
  return { committed: true, mode: M.BASELINE };
}

// ---------------------------------------------------------------------------
// Complete baseline (BASELINE → SHADOW) — gated + immediate second scan
// ---------------------------------------------------------------------------

export type CompleteBaselineResult =
  | { committed: false; reason: LifecycleCommitFailure; incompleteSegments?: string[] }
  | { committed: true; mode: DiscoverySourceLifecycleMode };

/**
 * Completes a source's baseline and enters SHADOW for the IMMEDIATE second scan
 * (`BASELINE → SHADOW`). The pure {@link decideBaselineCompletion} gate refuses
 * completion unless EVERY observable segment reached its boundary and committed
 * its checkpoint. On success it stamps `baselineCompletedAt`, records the initial
 * watermark (never regressing an existing one) and `baselineObservedCount`, and
 * marks the source immediately due so the second scan runs at once — identities
 * first observed DURING the baseline keep `observedInBaseline = true` (the sticky
 * cutover flag), so only genuinely new identities become shadow candidates.
 */
export async function completeBaseline(
  base: LifecycleCommitBase & {
    /** Every configured observable segment's completion state (the gate input). */
    segments: readonly BaselineSegmentState[];
    /** Initial watermark to record at completion (omit to leave it unchanged). */
    initialWatermark?: CompoundWatermark | null;
    /** Count of identities observed during the baseline (recorded for operators). */
    baselineObservedCount?: number;
  },
): Promise<CompleteBaselineResult> {
  const now = base.now ?? new Date();
  const loaded = await loadSource(base);
  if (!loaded.ok) return { committed: false, reason: loaded.reason };

  const from = loaded.source.lifecycleMode;
  if (classifyLifecycleTransition(from, M.SHADOW) !== "forward") {
    return { committed: false, reason: "invalid-transition" };
  }

  const gate = decideBaselineCompletion({ segments: base.segments });
  if (!gate.complete) {
    return {
      committed: false,
      reason: "baseline-incomplete",
      incompleteSegments: gate.incompleteSegments,
    };
  }

  const data: Prisma.DiscoverySourceUpdateManyMutationInput = {
    lifecycleMode: M.SHADOW,
    baselineCompletedAt: now,
    health: DiscoverySourceHealth.HEALTHY,
    nextRunAt: now,
    updatedAt: now,
  };
  if (base.baselineObservedCount !== undefined) {
    data.baselineObservedCount = base.baselineObservedCount;
  }
  // Record the initial watermark only when it strictly advances the existing one.
  if (base.initialWatermark && watermarkAdvances(base.initialWatermark, loaded.source.watermarkAt, loaded.source.watermarkKey)) {
    data.watermarkAt = base.initialWatermark.at;
    data.watermarkKey = base.initialWatermark.key;
  }

  const ok = await runGuardedTransition(base, from, data);
  if (!ok) return { committed: false, reason: "lease-lost" };
  log.info("discovery baseline completed; entering shadow", {
    sourceId: base.sourceId,
    baselineObservedCount: base.baselineObservedCount,
  });
  return { committed: true, mode: M.SHADOW };
}

function watermarkAdvances(
  next: CompoundWatermark,
  currentAt: Date | null,
  currentKey: string | null,
): boolean {
  if (currentAt === null) return true;
  const dt = next.at.getTime() - currentAt.getTime();
  if (dt > 0) return true;
  if (dt < 0) return false;
  return currentKey === null ? next.key.length > 0 : next.key > currentKey;
}

// ---------------------------------------------------------------------------
// Activate (SHADOW → ACTIVE) — explicit, audited, bounded catch-up
// ---------------------------------------------------------------------------

export type ActivateResult =
  | { committed: false; reason: LifecycleCommitFailure }
  | {
      committed: true;
      mode: DiscoverySourceLifecycleMode;
      /** Candidate ids moved DISCOVERED → QUEUED this call. */
      queuedCount: number;
      /** Shadow candidate ids left as observations (too old / over the count cap). */
      deferredCount: number;
    };

/**
 * Activates a source (`SHADOW → ACTIVE`): explicitly, atomically, and with a
 * bounded catch-up. Loads the source's post-baseline shadow candidates (status
 * `DISCOVERED`, `observedInBaseline = false`), asks the pure
 * {@link selectActivationCatchUp} selector which fall within BOTH limits
 * (default seven days / 100 candidates), and — in one guarded transaction —
 * stamps `activatedAt` (once), flips the mode to ACTIVE, and moves ONLY the
 * selected candidates `DISCOVERED → QUEUED`. Over-limit / too-old candidates stay
 * shadow observations (`DISCOVERED`).
 *
 * Idempotent + deterministic on retry: the candidate move is guarded on
 * `status = DISCOVERED`, so a retry re-queues nothing already QUEUED, and a retry
 * while already ACTIVE (a partial activation that flipped the mode before all
 * candidates were queued) resumes queueing the remaining eligible candidates
 * without changing `activatedAt`.
 */
export async function activateDiscoverySource(
  base: LifecycleCommitBase & { limits?: CatchUpLimits },
): Promise<ActivateResult> {
  const now = base.now ?? new Date();
  const loaded = await loadSource(base);
  if (!loaded.ok) return { committed: false, reason: loaded.reason };

  const from = loaded.source.lifecycleMode;
  // Activation is SHADOW → ACTIVE. An already-ACTIVE source is an idempotent
  // retry (resume queueing any still-DISCOVERED shadow candidates).
  const isRetry = from === M.ACTIVE;
  if (!isRetry && classifyLifecycleTransition(from, M.ACTIVE) !== "forward") {
    return { committed: false, reason: "invalid-transition" };
  }

  const shadowCandidates = await prisma.crawlCandidate.findMany({
    where: {
      discoverySourceId: base.sourceId,
      status: CrawlCandidateStatus.DISCOVERED,
      observedInBaseline: false,
    },
    select: { id: true, provisionalKey: true, firstObservedAt: true, trustedPublishedAt: true },
  });

  const decision = selectActivationCatchUp(shadowCandidates, { now, limits: base.limits });

  const data: Prisma.DiscoverySourceUpdateManyMutationInput = {
    lifecycleMode: M.ACTIVE,
    health: DiscoverySourceHealth.HEALTHY,
    nextRunAt: now,
    updatedAt: now,
  };
  // Stamp activation time only once (first activation).
  if (loaded.source.activatedAt === null) data.activatedAt = now;

  const queueCandidates = async (tx: Prisma.TransactionClient) => {
    if (decision.queue.length === 0) return;
    // Guarded on DISCOVERED so a retry never re-queues an already-QUEUED
    // candidate, and never disturbs a baseline observation.
    await tx.crawlCandidate.updateMany({
      where: {
        id: { in: decision.queue },
        discoverySourceId: base.sourceId,
        status: CrawlCandidateStatus.DISCOVERED,
        observedInBaseline: false,
      },
      data: { status: CrawlCandidateStatus.QUEUED, updatedAt: now },
    });
  };

  const ok = await runGuardedTransition(base, from, data, queueCandidates);
  if (!ok) return { committed: false, reason: "lease-lost" };

  log.info("discovery source activated", {
    sourceId: base.sourceId,
    queuedCount: decision.queue.length,
    deferredCount: decision.deferred.length,
    ageCutoff: decision.ageCutoff.toISOString(),
  });
  return {
    committed: true,
    mode: M.ACTIVE,
    queuedCount: decision.queue.length,
    deferredCount: decision.deferred.length,
  };
}

// ---------------------------------------------------------------------------
// Pause / resume / rollback / retire
// ---------------------------------------------------------------------------

export type TransitionResult =
  | { committed: false; reason: LifecycleCommitFailure }
  | { committed: true; mode: DiscoverySourceLifecycleMode };

/**
 * Applies a pause / resume / rollback / retire transition to a source. The pure
 * {@link classifyLifecycleTransition} validates the `from → to` edge (refusing
 * anything else); the guarded update flips `lifecycleMode` and adjusts
 * scheduling: a source that is no longer active-ish (PAUSED/DISABLED/RETIRED)
 * has `nextRunAt` cleared so the claim predicate never picks it up, while a
 * resume marks it immediately due. Records nothing about identities.
 */
export async function transitionDiscoveryLifecycle(
  base: LifecycleCommitBase & { targetMode: DiscoverySourceLifecycleMode },
): Promise<TransitionResult> {
  const now = base.now ?? new Date();
  const loaded = await loadSource(base);
  if (!loaded.ok) return { committed: false, reason: loaded.reason };

  const from = loaded.source.lifecycleMode;
  const kind = classifyLifecycleTransition(from, base.targetMode);
  if (kind === null) return { committed: false, reason: "invalid-transition" };

  const scheduled = base.targetMode === M.SHADOW || base.targetMode === M.BASELINE || base.targetMode === M.ACTIVE;
  const data: Prisma.DiscoverySourceUpdateManyMutationInput = {
    lifecycleMode: base.targetMode,
    // A paused / disabled / retired source is never due; a resumed one is due now.
    nextRunAt: scheduled ? now : null,
    updatedAt: now,
  };

  const ok = await runGuardedTransition(base, from, data);
  if (!ok) return { committed: false, reason: "lease-lost" };
  log.info("discovery lifecycle transition", {
    sourceId: base.sourceId,
    from,
    to: base.targetMode,
    kind,
  });
  return { committed: true, mode: base.targetMode };
}
