/**
 * Thin, guarded source-trust promotion/demotion persistence (issue #1100, Phase
 * 3.1).
 *
 * Trust promotion is EXPLICIT, version-scoped, and reversible: an operator turns a
 * proven source's `autoPublishTrusted` flag on (and off) — nothing here ever
 * escalates trust automatically. Every mutation is a guarded
 * `updateMany({ where: { id, definitionVersion, autoPublishTrusted } })` so it is
 * scoped to the exact definition version the operator reviewed (a re-versioned
 * source aborts the write) and is idempotent (a repeat is a no-op).
 *
 *   - {@link promoteSourceTrust}: idle-guarded, refuses when the pure eligibility
 *     REPORT is not clear (so metrics never auto-promote AND a hard governing-
 *     invariant violation — an old-item false positive — can never be promoted).
 *   - {@link demoteSourceTrust}: idle-guarded manual revocation of the trust flag.
 *   - {@link evaluateAndApplyTrustDemotion}: the DRIFT auto-demote, run under the
 *     worker's own lease at run finalization. When a configured anomaly fires it
 *     revokes the flag AND returns an ACTIVE source to SHADOW (via the existing
 *     guarded lifecycle transition), which is reversible and PRESERVES all
 *     candidate history (AC3). It NEVER throws, so a demotion fault can't break the
 *     discovery loop.
 *
 * No body is fetched, no Article is written, and no candidate row is ever deleted
 * by any function here.
 */
import {
  DiscoverySourceLifecycleMode,
  type DiscoverySource,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/observability/logger";

import { transitionDiscoveryLifecycle } from "./lifecycle-commit";
import {
  decideSourceTrustDemotion,
  type SourceTrustBlocker,
  type SourceTrustDemotionReason,
  type SourceTrustDemotionThresholds,
  type SourceTrustEvidence,
} from "./source-trust-policy";
import {
  getSourceTrustSnapshot,
  type SourceTrustPolicySnapshot,
} from "./source-trust-query";

const log = createLogger("source-trust");

const M = DiscoverySourceLifecycleMode;

/** Why a trust commit did not persist (sanitized category). */
export type SourceTrustCommitFailure =
  | "source-not-found"
  | "version-mismatch"
  | "busy"
  | "ineligible"
  | "stale";

export type SourceTrustAction = "promote" | "demote";

/** Outcome of a manual promote/demote (route maps failures to HTTP status). */
export type SourceTrustCommitResult =
  | {
      ok: true;
      action: SourceTrustAction;
      /** False when the source was already in the target trust state (idempotent). */
      changed: boolean;
      sourceId: string;
      definitionVersion: number;
      before: SourceTrustPolicySnapshot;
      after: SourceTrustPolicySnapshot;
      evidence: SourceTrustEvidence;
      /** Present when a demote also rolled the lifecycle mode (auto-demote only). */
      toMode?: DiscoverySourceLifecycleMode;
    }
  | {
      ok: false;
      action: SourceTrustAction;
      sourceId: string;
      reason: SourceTrustCommitFailure;
      /** Present for `ineligible`: the hard blockers the operator must clear. */
      blockers?: SourceTrustBlocker[];
    };

type FlagCommit =
  | { kind: "committed" }
  | { kind: "noop" }
  | { kind: "failed"; reason: SourceTrustCommitFailure };

/**
 * Runs one guarded trust-flag update. Matches ONLY a row whose lease,
 * `definitionVersion`, and current `autoPublishTrusted` all equal the expected
 * values; a zero-row result is re-read + classified into an idempotent no-op
 * (already in the target state) or a typed failure.
 */
async function runGuardedFlagUpdate(
  base: { sourceId: string; leaseOwner: string | null; definitionVersion: number; now: Date },
  expectedTrusted: boolean,
): Promise<FlagCommit> {
  const targetTrusted = !expectedTrusted;
  const updated = await prisma.discoverySource.updateMany({
    where: {
      id: base.sourceId,
      leaseOwner: base.leaseOwner,
      definitionVersion: base.definitionVersion,
      autoPublishTrusted: expectedTrusted,
    },
    data: { autoPublishTrusted: targetTrusted, updatedAt: base.now },
  });
  if (updated.count > 0) return { kind: "committed" };

  const fresh = await prisma.discoverySource.findUnique({
    where: { id: base.sourceId },
    select: { leaseOwner: true, definitionVersion: true, autoPublishTrusted: true },
  });
  if (!fresh) return { kind: "failed", reason: "source-not-found" };
  if (fresh.autoPublishTrusted === targetTrusted) return { kind: "noop" };
  if (fresh.definitionVersion !== base.definitionVersion) {
    return { kind: "failed", reason: "version-mismatch" };
  }
  if (fresh.leaseOwner !== base.leaseOwner) return { kind: "failed", reason: "busy" };
  return { kind: "failed", reason: "stale" };
}

/**
 * Promotes a source's trust EXPLICITLY. Version-scoped (guarded on the operator's
 * expected `definitionVersion`) and idle-guarded. Refuses when the pure
 * eligibility report is not clear — so metrics alone never promote and an
 * old-item false positive (governing-invariant violation) can never be trusted.
 */
export async function promoteSourceTrust(input: {
  sourceId: string;
  definitionVersion: number;
  now?: Date;
}): Promise<SourceTrustCommitResult> {
  const now = input.now ?? new Date();
  const snapshot = await getSourceTrustSnapshot(input.sourceId, now);
  if (!snapshot) {
    return { ok: false, action: "promote", sourceId: input.sourceId, reason: "source-not-found" };
  }
  if (snapshot.definitionVersion !== input.definitionVersion) {
    return { ok: false, action: "promote", sourceId: input.sourceId, reason: "version-mismatch" };
  }

  const before = snapshot.policy;
  if (before.autoPublishTrusted) {
    // Already trusted — idempotent no-op.
    return {
      ok: true,
      action: "promote",
      changed: false,
      sourceId: input.sourceId,
      definitionVersion: snapshot.definitionVersion,
      before,
      after: before,
      evidence: snapshot.evidence,
    };
  }
  if (!snapshot.eligibility.eligible) {
    return {
      ok: false,
      action: "promote",
      sourceId: input.sourceId,
      reason: "ineligible",
      blockers: snapshot.eligibility.blockers,
    };
  }

  const flag = await runGuardedFlagUpdate(
    { sourceId: input.sourceId, leaseOwner: null, definitionVersion: input.definitionVersion, now },
    false,
  );
  if (flag.kind === "noop") {
    return {
      ok: true,
      action: "promote",
      changed: false,
      sourceId: input.sourceId,
      definitionVersion: snapshot.definitionVersion,
      before,
      after: { ...before, autoPublishTrusted: true },
      evidence: snapshot.evidence,
    };
  }
  if (flag.kind === "failed") {
    return { ok: false, action: "promote", sourceId: input.sourceId, reason: flag.reason };
  }

  return {
    ok: true,
    action: "promote",
    changed: true,
    sourceId: input.sourceId,
    definitionVersion: snapshot.definitionVersion,
    before,
    after: { ...before, autoPublishTrusted: true },
    evidence: snapshot.evidence,
  };
}

/**
 * Manually demotes (revokes) a source's trust flag. Version-scoped + idle-guarded
 * and reversible via {@link promoteSourceTrust}. A manual demote only toggles the
 * trust flag; it does NOT change the lifecycle mode (the operator has a separate
 * lifecycle rollback action). Idempotent when the source is already untrusted.
 */
export async function demoteSourceTrust(input: {
  sourceId: string;
  definitionVersion: number;
  now?: Date;
}): Promise<SourceTrustCommitResult> {
  const now = input.now ?? new Date();
  const snapshot = await getSourceTrustSnapshot(input.sourceId, now);
  if (!snapshot) {
    return { ok: false, action: "demote", sourceId: input.sourceId, reason: "source-not-found" };
  }
  if (snapshot.definitionVersion !== input.definitionVersion) {
    return { ok: false, action: "demote", sourceId: input.sourceId, reason: "version-mismatch" };
  }

  const before = snapshot.policy;
  if (!before.autoPublishTrusted) {
    return {
      ok: true,
      action: "demote",
      changed: false,
      sourceId: input.sourceId,
      definitionVersion: snapshot.definitionVersion,
      before,
      after: before,
      evidence: snapshot.evidence,
    };
  }

  const flag = await runGuardedFlagUpdate(
    { sourceId: input.sourceId, leaseOwner: null, definitionVersion: input.definitionVersion, now },
    true,
  );
  if (flag.kind === "noop") {
    return {
      ok: true,
      action: "demote",
      changed: false,
      sourceId: input.sourceId,
      definitionVersion: snapshot.definitionVersion,
      before,
      after: { ...before, autoPublishTrusted: false },
      evidence: snapshot.evidence,
    };
  }
  if (flag.kind === "failed") {
    return { ok: false, action: "demote", sourceId: input.sourceId, reason: flag.reason };
  }

  return {
    ok: true,
    action: "demote",
    changed: true,
    sourceId: input.sourceId,
    definitionVersion: snapshot.definitionVersion,
    before,
    after: { ...before, autoPublishTrusted: false },
    evidence: snapshot.evidence,
  };
}

/** Result of the drift auto-demotion evaluation. */
export type TrustDemotionResult = {
  demoted: boolean;
  reasons: SourceTrustDemotionReason[];
};

/**
 * Evaluates the drift/anomaly auto-demotion for a just-finished run and, when a
 * configured anomaly fires on a TRUSTED source, revokes the trust flag AND (for an
 * ACTIVE source) rolls it back to SHADOW under the worker's own lease. The
 * lifecycle roll reuses the guarded `transitionDiscoveryLifecycle`, so ALL
 * candidate/checkpoint/watermark history is preserved (AC3). NEVER throws — any
 * fault is caught + logged so a demotion failure can't break the discovery loop.
 *
 * Cheap early-out: an untrusted source has no trust to revoke, so nothing is read.
 */
export async function evaluateAndApplyTrustDemotion(input: {
  source: DiscoverySource;
  zeroDiscoveryStreak: number;
  now: Date;
  thresholds?: SourceTrustDemotionThresholds;
  logger?: { info: (m: string, meta?: Record<string, unknown>) => void; warn: (m: string, meta?: Record<string, unknown>) => void };
}): Promise<TrustDemotionResult> {
  const { source, now } = input;
  const logger = input.logger ?? log;

  if (!source.autoPublishTrusted) return { demoted: false, reasons: [] };

  const snapshot = await getSourceTrustSnapshot(source.id, now);
  if (!snapshot || !snapshot.policy.autoPublishTrusted) {
    return { demoted: false, reasons: [] };
  }

  const decision = decideSourceTrustDemotion(
    { isTrusted: true, drift: snapshot.evidence.drift },
    input.thresholds,
  );
  if (decision.action !== "demote") return { demoted: false, reasons: decision.reasons };
  if (!source.leaseOwner) return { demoted: false, reasons: decision.reasons };

  try {
    const flag = await runGuardedFlagUpdate(
      {
        sourceId: source.id,
        leaseOwner: source.leaseOwner,
        definitionVersion: source.definitionVersion,
        now,
      },
      true,
    );
    if (flag.kind !== "committed") {
      logger.warn("source trust auto-demotion flag not committed", {
        sourceId: source.id,
        outcome: flag.kind,
      });
      return { demoted: false, reasons: decision.reasons };
    }

    // Return an ACTIVE source to SHADOW (reversible; preserves candidate history).
    if (source.lifecycleMode === M.ACTIVE) {
      const rolled = await transitionDiscoveryLifecycle({
        sourceId: source.id,
        leaseOwner: source.leaseOwner,
        definitionVersion: source.definitionVersion,
        targetMode: M.SHADOW,
        now,
      });
      if (!rolled.committed) {
        logger.warn("source trust auto-demotion shadow roll not committed", {
          sourceId: source.id,
          reason: rolled.reason,
        });
      }
    }

    logger.info("source trust auto-demoted", {
      sourceId: source.id,
      reasons: decision.reasons,
    });
    return { demoted: true, reasons: decision.reasons };
  } catch (error) {
    logger.warn("source trust auto-demotion failed", {
      sourceId: source.id,
      error: error instanceof Error ? error.name : "Error",
    });
    return { demoted: false, reasons: decision.reasons };
  }
}
