/**
 * Discovery source-definition VERSION replacement + rollback (issue #1090,
 * Phase 1.10, AC3).
 *
 * A source "definition version" is the versioned admission/normalization code a
 * source runs under. It is the cross-program guard: the lease, checkpoint advance,
 * frontier commit, and every lifecycle transition all revalidate
 * `definitionVersion`, so two versions can NEVER process one source concurrently.
 *
 * Representing each version as a DISTINCT `DiscoverySource` row — keyed by the
 * existing `@@unique([providerKey, sourceKey, definitionVersion])` — means a new
 * version has its OWN lease, checkpoint, watermark, and candidate ledger, so it
 * runs INDEPENDENTLY in shadow while the prior version is RETAINED untouched. A
 * rollback simply RETIRES the newer row; the retained prior row is already intact
 * and restorable. No schema change is needed.
 *
 * The pure planners here (`nextDefinitionVersion`, `planRollback`) are DB-free and
 * unit-tested; the guarded commit helpers apply them under the same
 * lease/version-guarded pattern used across the program. All values are metadata
 * only (versions, modes, ids) — never a URL/body/secret.
 */
import {
  DiscoverySourceLifecycleMode,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/observability/logger";

const log = createLogger("discovery-definition-version");
const M = DiscoverySourceLifecycleMode;

/** A minimal per-version snapshot the pure planners read. */
export type DefinitionVersionSnapshot = {
  definitionVersion: number;
  lifecycleMode: DiscoverySourceLifecycleMode;
};

/**
 * The next definition version to allocate for a `(providerKey, sourceKey)` family:
 * one above the current maximum, or 1 when none exist. Pure.
 */
export function nextDefinitionVersion(versions: readonly number[]): number {
  return versions.length === 0 ? 1 : Math.max(...versions) + 1;
}

/** Outcome of {@link planRollback}. */
export type RollbackPlan = {
  /** The newest non-retired version to retire (the experiment being unwound). */
  retire: number;
  /** The highest retained older version to keep as the restored definition. */
  restore: number;
};

/**
 * Plans a rollback: retire the NEWEST non-retired version and restore the highest
 * retained OLDER version. Returns `null` when there is no older retained version
 * to fall back to (nothing safe to roll back to). Pure and deterministic.
 */
export function planRollback(
  versions: readonly DefinitionVersionSnapshot[],
): RollbackPlan | null {
  const live = versions
    .filter((v) => v.lifecycleMode !== M.RETIRED)
    .sort((a, b) => b.definitionVersion - a.definitionVersion);
  if (live.length < 2) return null;
  const retire = live[0].definitionVersion;
  const restore = live[1].definitionVersion;
  return { retire, restore };
}

export type ReplaceDefinitionVersionResult =
  | { created: false; reason: "source-family-not-found" }
  | { created: true; priorVersion: number; newVersion: number; newSourceId: string };

/**
 * Creates a NEW definition-version row for a `(providerKey, sourceKey)` family,
 * seeded DISABLED (so it begins its OWN independent baseline → shadow), copying
 * the schedule/role/budget config from the current highest version. The prior
 * version row is left completely UNTOUCHED (retained + restorable). Idempotency is
 * provided by the unique `(providerKey, sourceKey, definitionVersion)` constraint.
 */
export async function replaceDefinitionVersion(input: {
  providerKey: string;
  sourceKey: string;
  now?: Date;
}): Promise<ReplaceDefinitionVersionResult> {
  const now = input.now ?? new Date();
  const existing = await prisma.discoverySource.findMany({
    where: { providerKey: input.providerKey, sourceKey: input.sourceKey },
    orderBy: { definitionVersion: "desc" },
  });
  if (existing.length === 0) return { created: false, reason: "source-family-not-found" };

  const prior = existing[0];
  const newVersion = nextDefinitionVersion(existing.map((s) => s.definitionVersion));

  const created = await prisma.discoverySource.create({
    data: {
      providerKey: input.providerKey,
      sourceKey: input.sourceKey,
      definitionVersion: newVersion,
      lifecycleMode: M.DISABLED,
      role: prior.role,
      automationPolicy: prior.automationPolicy,
      scheduleCron: prior.scheduleCron,
      pollIntervalSeconds: prior.pollIntervalSeconds,
      discoveryBudgetPerRun: prior.discoveryBudgetPerRun,
      bodyFetchBudgetPerRun: prior.bodyFetchBudgetPerRun,
      backfillBudgetPerRun: prior.backfillBudgetPerRun,
      createdAt: now,
      updatedAt: now,
    },
  });

  log.info("discovery definition version replaced", {
    providerKey: input.providerKey,
    priorVersion: prior.definitionVersion,
    newVersion,
  });
  return { created: true, priorVersion: prior.definitionVersion, newVersion, newSourceId: created.id };
}

export type RollbackDefinitionVersionResult =
  | { rolledBack: false; reason: "no-prior-version" | "source-family-not-found" }
  | { rolledBack: true; retiredVersion: number; restoredVersion: number; restoredSourceId: string };

/**
 * Rolls a `(providerKey, sourceKey)` family back to its retained prior version:
 * RETIRES the newest non-retired version (guarded on its `definitionVersion` +
 * current mode) and returns the retained prior version, which is already intact
 * and restorable through the normal gated activation path. Never touches the
 * prior version's candidate/checkpoint/watermark state.
 */
export async function rollbackDefinitionVersion(input: {
  providerKey: string;
  sourceKey: string;
  now?: Date;
}): Promise<RollbackDefinitionVersionResult> {
  const now = input.now ?? new Date();
  const existing = await prisma.discoverySource.findMany({
    where: { providerKey: input.providerKey, sourceKey: input.sourceKey },
    select: { id: true, definitionVersion: true, lifecycleMode: true },
  });
  if (existing.length === 0) return { rolledBack: false, reason: "source-family-not-found" };

  const plan = planRollback(existing);
  if (!plan) return { rolledBack: false, reason: "no-prior-version" };

  const retireRow = existing.find((s) => s.definitionVersion === plan.retire)!;
  const restoreRow = existing.find((s) => s.definitionVersion === plan.restore)!;

  // Guarded retire: only if the version is still in the mode we planned against
  // and is not lease-held by a worker (idle admin action).
  const updated = await prisma.discoverySource.updateMany({
    where: {
      id: retireRow.id,
      definitionVersion: plan.retire,
      lifecycleMode: retireRow.lifecycleMode,
      leaseOwner: null,
    },
    data: { lifecycleMode: M.RETIRED, nextRunAt: null, updatedAt: now },
  });
  if (updated.count === 0) return { rolledBack: false, reason: "no-prior-version" };

  log.info("discovery definition version rolled back", {
    providerKey: input.providerKey,
    retiredVersion: plan.retire,
    restoredVersion: plan.restore,
  });
  return {
    rolledBack: true,
    retiredVersion: plan.retire,
    restoredVersion: plan.restore,
    restoredSourceId: restoreRow.id,
  };
}

/** Reads the version snapshots for a `(providerKey, sourceKey)` family. */
export async function readDefinitionVersions(
  providerKey: string,
  sourceKey: string,
): Promise<Array<DefinitionVersionSnapshot & { id: string }>> {
  const rows = await prisma.discoverySource.findMany({
    where: { providerKey, sourceKey },
    select: { id: true, definitionVersion: true, lifecycleMode: true },
    orderBy: { definitionVersion: "asc" },
  });
  return rows as Array<DefinitionVersionSnapshot & { id: string }>;
}
