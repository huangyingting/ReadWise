/**
 * Thin, guarded persistence of the incremental-discovery frontier decision
 * (issue #1086, Phase 1.6).
 *
 * The frontier DECISIONS (next compound watermark, completeness gap, validator
 * calibration outcome, run-completion / caught-up accounting) are computed by
 * the PURE `frontier.ts` module from an already-fetched run. This module ONLY
 * persists that decision onto `DiscoverySource`, reusing the #1085
 * `commitDiscoveryPage` safety pattern:
 *
 *   - reads happen BEFORE the transaction; the single interactive
 *     `$transaction` re-reads + revalidates the lease/`definitionVersion` and
 *     advances state via a guarded `updateMany({ where: { id, leaseOwner,
 *     definitionVersion } })`. A zero-row update means the lease was lost/stolen
 *     → the whole write rolls back and NOTHING is persisted.
 *
 * Governing-invariant guards enforced here:
 *   - The watermark NEVER regresses: a lower/equal proposed `(at, key)` is
 *     ignored (belt-and-braces on top of `computeNextWatermark`).
 *   - A gap is durable and visible: entering `DETECTED` stamps `gapDetectedAt`
 *     once and records a redacted, metadata-only note; clearing to `NONE` resets
 *     both. A rolled-window gap NEVER blocks recording current candidates
 *     (that already happened in the page commit) and NEVER triggers a fetch.
 *   - A disabled/stale validator clears `validatorVersion` so a bad long-lived
 *     `304` cannot keep suppressing discovery.
 *   - A source is only marked caught up (health advanced) by the caller's
 *     run-completion decision; a partial/failed run cannot do so.
 */
import { DiscoveryGapState, DiscoverySourceHealth, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import type { CompoundWatermark } from "./frontier";

/** The frontier state to persist for one completed discovery run. */
export type FrontierDecision = {
  /**
   * Next compound watermark to persist. `null`/omitted leaves the watermark
   * unchanged. A value at or before the current watermark is ignored (never
   * regress).
   */
  watermark?: CompoundWatermark | null;
  /** Completeness gap state + redacted note. Omit to leave the gap unchanged. */
  gap?: { state: DiscoveryGapState; note: string | null };
  /**
   * Validator outcome. `disable: true` clears `validatorVersion` (a stale/
   * misleading validator can no longer suppress discovery). Otherwise a provided
   * `version` is recorded. Omit to leave the validator unchanged.
   */
  validator?: { disable?: boolean; version?: string };
  /** Operational health to record (e.g. from `decideRunCompletion`). */
  health?: DiscoverySourceHealth;
  /** When set, records `lastRunAt`. */
  runAt?: Date;
};

export type CommitFrontierStateOptions = {
  sourceId: string;
  /** Opaque worker lease token; must still match `DiscoverySource.leaseOwner`. */
  leaseOwner: string;
  /** Expected `DiscoverySource.definitionVersion`; a mismatch is a stale definition. */
  definitionVersion: number;
  decision: FrontierDecision;
  /** Override "now" (testing / determinism). */
  now?: Date;
  /**
   * TEST-ONLY hook invoked INSIDE the transaction right before the guarded
   * update (mutating the source via `tx` proves a mid-commit lease steal aborts
   * the write). Never set in production.
   */
  debugHooks?: { beforeUpdate?: (tx: Prisma.TransactionClient) => void | Promise<void> };
};

export type CommitFrontierStateResult =
  | { committed: false; reason: "source-not-found" | "lease-lost" }
  | {
      committed: true;
      watermarkAdvanced: boolean;
      gapState: DiscoveryGapState;
      validatorDisabled: boolean;
    };

/** Rolls the whole transaction back on a lost/stolen lease. */
class LeaseLostError extends Error {
  constructor() {
    super("discovery source lease/version lost during frontier commit");
    this.name = "LeaseLostError";
  }
}

function watermarkStrictlyAdvances(
  next: CompoundWatermark,
  currentAt: Date | null,
  currentKey: string | null,
): boolean {
  if (currentAt === null) return true;
  const dt = next.at.getTime() - currentAt.getTime();
  if (dt > 0) return true;
  if (dt < 0) return false;
  // Same timestamp: advance only if the compound key is strictly greater.
  return currentKey === null ? next.key.length > 0 : next.key > currentKey;
}

/**
 * Persists a computed {@link FrontierDecision} onto `DiscoverySource` in ONE
 * guarded transaction. Returns `{ committed: false }` (no writes) when the source
 * is missing or the lease/version was lost before OR during the write.
 */
export async function commitFrontierState(
  options: CommitFrontierStateOptions,
): Promise<CommitFrontierStateResult> {
  const now = options.now ?? new Date();
  const { sourceId, leaseOwner, definitionVersion, decision } = options;

  const source = await prisma.discoverySource.findUnique({
    where: { id: sourceId },
    select: {
      leaseOwner: true,
      definitionVersion: true,
      watermarkAt: true,
      watermarkKey: true,
      gapState: true,
      gapDetectedAt: true,
    },
  });
  if (!source) return { committed: false, reason: "source-not-found" };
  if (source.leaseOwner !== leaseOwner || source.definitionVersion !== definitionVersion) {
    return { committed: false, reason: "lease-lost" };
  }

  const data: Prisma.DiscoverySourceUpdateManyMutationInput = { updatedAt: now };

  // --- Watermark (never regress). ------------------------------------------
  let watermarkAdvanced = false;
  if (decision.watermark) {
    if (watermarkStrictlyAdvances(decision.watermark, source.watermarkAt, source.watermarkKey)) {
      data.watermarkAt = decision.watermark.at;
      data.watermarkKey = decision.watermark.key;
      watermarkAdvanced = true;
    }
  }

  // --- Gap (durable + visible). --------------------------------------------
  const gapState = decision.gap?.state ?? source.gapState;
  if (decision.gap) {
    data.gapState = decision.gap.state;
    data.gapNote = decision.gap.note;
    if (decision.gap.state === DiscoveryGapState.NONE) {
      data.gapDetectedAt = null;
    } else if (source.gapState !== decision.gap.state || source.gapDetectedAt === null) {
      // Stamp the detection time once, on transition into a gap state.
      data.gapDetectedAt = now;
    }
  }

  // --- Validator calibration. ----------------------------------------------
  let validatorDisabled = false;
  if (decision.validator) {
    if (decision.validator.disable) {
      data.validatorVersion = null;
      validatorDisabled = true;
    } else if (decision.validator.version !== undefined) {
      data.validatorVersion = decision.validator.version;
    }
  }

  // --- Health / run accounting. --------------------------------------------
  if (decision.health) data.health = decision.health;
  if (decision.runAt) data.lastRunAt = decision.runAt;

  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.discoverySource.findUnique({
        where: { id: sourceId },
        select: { leaseOwner: true, definitionVersion: true },
      });
      if (
        !current ||
        current.leaseOwner !== leaseOwner ||
        current.definitionVersion !== definitionVersion
      ) {
        throw new LeaseLostError();
      }

      await options.debugHooks?.beforeUpdate?.(tx);

      const updated = await tx.discoverySource.updateMany({
        where: { id: sourceId, leaseOwner, definitionVersion },
        data,
      });
      if (updated.count === 0) throw new LeaseLostError();
    });
  } catch (error) {
    if (error instanceof LeaseLostError) return { committed: false, reason: "lease-lost" };
    throw error;
  }

  return { committed: true, watermarkAdvanced, gapState, validatorDisabled };
}
