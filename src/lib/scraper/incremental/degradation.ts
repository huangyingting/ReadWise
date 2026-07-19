/**
 * PURE discovery-source auto-degradation decision (issue #1089, Phase 1.9).
 *
 * A drifting ACTIVE source — one that keeps returning HTTP 200 but discovers
 * nothing new, or whose watermark has stalled for too long — should be quietly
 * DEMOTED back to SHADOW so it stops driving automation, WITHOUT losing any
 * checkpoint/candidate/watermark state and while staying fully recoverable (the
 * existing SHADOW→ACTIVE transition re-activates it). This module contains the
 * PURE decision only: it takes a metadata-only {@link DegradationSignals}
 * snapshot plus provider-aware {@link DegradationThresholds} and returns a
 * {@link DegradationDecision}. It NEVER touches the database, network, or clock,
 * NEVER triggers body work or ingestion, and NEVER reads a URL/body/secret —
 * mirroring the pure-logic house style of `lifecycle.ts` / `frontier.ts`.
 *
 * The thin caller (`observability-query.ts#evaluateAndApplyDegradation`, wired
 * into the discovery run finalizer under the worker's own lease) applies a
 * `demote-to-shadow` decision via the guarded `transitionDiscoveryLifecycle`
 * (ACTIVE→SHADOW is a safe "rollback" edge). Only ACTIVE sources are ever
 * auto-degraded; every other lifecycle mode is left untouched.
 */
import { DiscoverySourceLifecycleMode } from "@prisma/client";

const M = DiscoverySourceLifecycleMode;

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Thresholds (provider-aware)
// ---------------------------------------------------------------------------

/**
 * Provider-aware degradation thresholds. Deliberately set ABOVE the status
 * thresholds in `observability.ts`, so a source reads `stalled` (a warning) for
 * a while before it is actually demoted.
 */
export type DegradationThresholds = {
  /**
   * Consecutive successful (boundary-reached HTTP-200) runs discovering ZERO new
   * identities before the source is demoted. The sustained HTTP-200/zero-
   * discovery drift trigger (AC3).
   */
  maxZeroDiscoveryStreak: number;
  /**
   * Watermark stall age (ms) beyond which an otherwise-running ACTIVE source is
   * demoted. `null` disables the watermark-stall trigger for a provider.
   */
  maxWatermarkStallMs: number | null;
};

/** Default demotion thresholds applied when a provider has no override. */
export const DEFAULT_DEGRADATION_THRESHOLDS: DegradationThresholds = {
  maxZeroDiscoveryStreak: 8,
  maxWatermarkStallMs: 21 * DAY_MS,
};

/**
 * Optional per-provider threshold overrides, keyed by provider key. Values are
 * shallow-merged over {@link DEFAULT_DEGRADATION_THRESHOLDS}. Kept as a plain map
 * so the decision stays pure and provider-awareness is data, not code.
 */
export type ProviderThresholdOverrides = Readonly<
  Record<string, Partial<DegradationThresholds>>
>;

/**
 * Resolves the effective thresholds for a provider by shallow-merging any
 * override over the defaults. Pure; safe to call per evaluation.
 */
export function resolveDegradationThresholds(
  providerKey: string,
  overrides?: ProviderThresholdOverrides,
): DegradationThresholds {
  const override = overrides?.[providerKey];
  if (!override) return DEFAULT_DEGRADATION_THRESHOLDS;
  return { ...DEFAULT_DEGRADATION_THRESHOLDS, ...override };
}

// ---------------------------------------------------------------------------
// Signals + decision
// ---------------------------------------------------------------------------

/**
 * The metadata-only drift snapshot the decision reads. Every field is a count,
 * duration, flag, or enum — never a URL/body/secret.
 */
export type DegradationSignals = {
  lifecycleMode: DiscoverySourceLifecycleMode;
  /** Consecutive successful runs discovering zero new identities. */
  zeroDiscoveryStreak: number;
  /** Watermark stall age in ms (`now − watermarkAt`), or null when no watermark. */
  watermarkStallMs: number | null;
  /** Consecutive hard run failures. */
  consecutiveFailures: number;
};

/** Why the decision chose its action (sanitized category — never a URL/body). */
export type DegradationReason =
  | "not-active"
  | "within-thresholds"
  | "zero-discovery-drift"
  | "watermark-stall";

/**
 * The decision. `keep` leaves the source ACTIVE; `demote-to-shadow` asks the
 * caller to roll the source back to SHADOW (reversible, state-preserving).
 */
export type DegradationDecision = {
  action: "keep" | "demote-to-shadow";
  reason: DegradationReason;
};

/**
 * Decides whether a drifting ACTIVE source should be demoted to SHADOW. PURE and
 * deterministic.
 *
 *   - Only ACTIVE sources are considered; any other mode → `keep` / `not-active`
 *     (BASELINE/SHADOW are pre-active; PAUSED/DISABLED/RETIRED are operator
 *     states that auto-degradation must never disturb).
 *   - A zero-discovery streak at/above `maxZeroDiscoveryStreak` → demote with
 *     `zero-discovery-drift` (the AC3 trigger). Checked first so the sustained
 *     HTTP-200/zero-discovery scenario is the primary, most-specific reason.
 *   - Otherwise a watermark stall at/above `maxWatermarkStallMs` (when enabled)
 *     → demote with `watermark-stall`.
 *   - Otherwise `keep` / `within-thresholds`.
 *
 * Run failures are intentionally NOT a demotion trigger here: they already drive
 * the failure backoff + FAILING health in the run handler, and are surfaced as a
 * `stalled` status. Demotion targets the SILENT drift a healthy-looking source
 * exhibits, which nothing else catches.
 */
export function decideDegradation(
  signals: DegradationSignals,
  thresholds: DegradationThresholds = DEFAULT_DEGRADATION_THRESHOLDS,
): DegradationDecision {
  if (signals.lifecycleMode !== M.ACTIVE) {
    return { action: "keep", reason: "not-active" };
  }

  if (signals.zeroDiscoveryStreak >= thresholds.maxZeroDiscoveryStreak) {
    return { action: "demote-to-shadow", reason: "zero-discovery-drift" };
  }

  if (
    thresholds.maxWatermarkStallMs !== null &&
    signals.watermarkStallMs !== null &&
    signals.watermarkStallMs >= thresholds.maxWatermarkStallMs
  ) {
    return { action: "demote-to-shadow", reason: "watermark-stall" };
  }

  return { action: "keep", reason: "within-thresholds" };
}

// ---------------------------------------------------------------------------
// Zero-discovery streak accounting
// ---------------------------------------------------------------------------

/**
 * Computes the next zero-discovery streak after a completed run. A run that
 * reached the observable boundary (a full HTTP-200 scan) but discovered zero new
 * eligible identities INCREMENTS the streak; any new discovery RESETS it to 0. A
 * run that did not reach the boundary is a mid-scan continuation and leaves the
 * streak unchanged (neither proof of drift nor of progress).
 *
 * PURE: this is the only place the streak is advanced, keeping the durable
 * counter's semantics testable without a database.
 */
export function nextZeroDiscoveryStreak(input: {
  previousStreak: number;
  boundaryReached: boolean;
  newlyDiscovered: number;
}): number {
  if (!input.boundaryReached) return input.previousStreak;
  if (input.newlyDiscovered > 0) return 0;
  return input.previousStreak + 1;
}
