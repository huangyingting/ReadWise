/**
 * PURE discovery-source scheduler clock (issue #1087, Phase 1.7).
 *
 * This module contains NO database or network access. Given a snapshot of a
 * `DiscoverySource`'s schedule tier, role, observed publication cadence, failure
 * backoff, pause state, and provider request budget, it computes the next SAFE
 * `nextRunAt` for the source. Keeping it pure (like `classify.ts` and
 * `frontier.ts`) makes every scheduling input — cadence bounds, each role tier,
 * backoff escalation, pause, and budget exhaustion — separately unit-testable
 * with NO real clock, database, or randomness, and guarantees the claim/loop
 * layers cannot re-implement the scheduling rules.
 *
 * The scheduler NEVER decides what to fetch or which identities to admit (that
 * is `classify.ts` / `frontier.ts`); it only decides WHEN a source becomes due
 * again. Returning `null` means "not due on a schedule" — a paused, disabled, or
 * dormant-fallback source is simply never picked up by the claim predicate
 * (a `NULL` `nextRunAt` never satisfies `nextRunAt <= now`).
 */
import {
  DiscoveryAutomationPolicy,
  DiscoverySourceLifecycleMode,
  DiscoverySourceRole,
} from "@prisma/client";

const SECOND_MS = 1000;

/** Lifecycle modes a scheduled source may be auto-claimed from. */
export const CLAIMABLE_LIFECYCLE_MODES: readonly DiscoverySourceLifecycleMode[] = [
  DiscoverySourceLifecycleMode.SHADOW,
  DiscoverySourceLifecycleMode.BASELINE,
  DiscoverySourceLifecycleMode.ACTIVE,
];

/** Automation policies that grant auto-claim scheduling autonomy. */
export const AUTO_CLAIM_POLICIES: readonly DiscoveryAutomationPolicy[] = [
  DiscoveryAutomationPolicy.SCHEDULED,
  DiscoveryAutomationPolicy.CONTINUOUS,
];

/**
 * Reconciliation tier a source runs at. There is no `FALLBACK` role in the
 * schema; the issue's three tiers map onto role + activation state:
 *   - `primary`      — PRIMARY_FEED / SECTION_INDEX / ARCHIVE_INDEX / SITEMAP,
 *                      run normally at the base cadence.
 *   - `supplemental` — SUPPLEMENTAL, run at a LOWER reconciliation frequency.
 * "Fallback" is modelled as a source (of either tier) that is only DUE while its
 * activation condition holds (see {@link ComputeNextRunAtInput.fallback}).
 */
export type ScheduleRoleTier = "primary" | "supplemental";

/** Base cadence per tier when a source carries no explicit `pollIntervalSeconds`. */
export const DEFAULT_PRIMARY_INTERVAL_SECONDS = 15 * 60;
export const DEFAULT_SUPPLEMENTAL_INTERVAL_SECONDS = 6 * 60 * 60;

/**
 * Factor by which a SUPPLEMENTAL source's cadence is stretched relative to an
 * explicit `pollIntervalSeconds`, so supplemental reconciliation always runs
 * less frequently than a primary source configured with the same interval.
 */
export const SUPPLEMENTAL_FREQUENCY_MULTIPLIER = 8;

/** Deterministic (jitter-free) failure backoff bounds, in seconds. */
export const BASE_BACKOFF_SECONDS = 60;
export const MAX_BACKOFF_SECONDS = 6 * 60 * 60;

/** How long to defer a source that exhausted its provider request budget. */
export const DEFAULT_BUDGET_COOLDOWN_SECONDS = 60 * 60;

/** Maps a source role onto its reconciliation tier. */
export function roleTier(role: DiscoverySourceRole): ScheduleRoleTier {
  return role === DiscoverySourceRole.SUPPLEMENTAL ? "supplemental" : "primary";
}

/**
 * Observed publication cadence bounds (seconds). Clamp the computed interval so
 * a bursty source is not polled faster than `minIntervalSeconds` and a quiet
 * source is still reconciled at least every `maxIntervalSeconds`.
 */
export type CadenceBounds = {
  minIntervalSeconds?: number;
  maxIntervalSeconds?: number;
};

/**
 * Fallback activation gate. When a source is `designated` as fallback it stays
 * DORMANT (returns `null` — not due) until `activated` (the caller sets this
 * when a related primary source is failing or produced zero discovery).
 */
export type FallbackGate = {
  designated: boolean;
  activated: boolean;
};

export type ComputeNextRunAtInput = {
  /** Reference "now". */
  now: Date;
  role: DiscoverySourceRole;
  automationPolicy: DiscoveryAutomationPolicy;
  lifecycleMode: DiscoverySourceLifecycleMode;
  /** Configured base cadence; falls back to the tier default when absent. */
  pollIntervalSeconds?: number | null;
  /**
   * Reserved schedule-tier hint. Cron is NOT parsed here (no dependency); when
   * present it is treated as an opaque marker that a cadence is configured and
   * `pollIntervalSeconds` / the tier default drives the interval.
   */
  scheduleCron?: string | null;
  /** Observed publication cadence bounds used to clamp the interval. */
  cadenceBounds?: CadenceBounds;
  /** Exponential failure backoff level (0 = healthy). */
  backoffLevel?: number;
  /** Explicit operator pause; a paused source is never due. */
  paused?: boolean;
  /** The just-finished run exhausted the provider request budget. */
  budgetExhausted?: boolean;
  /** Cooldown applied when `budgetExhausted`. Defaults to the module constant. */
  budgetCooldownSeconds?: number;
  /** Fallback activation gate (see {@link FallbackGate}). */
  fallback?: FallbackGate;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Base cadence in seconds from explicit config or the tier default. */
function baseIntervalSeconds(input: ComputeNextRunAtInput, tier: ScheduleRoleTier): number {
  if (input.pollIntervalSeconds != null && input.pollIntervalSeconds > 0) {
    return input.pollIntervalSeconds;
  }
  return tier === "supplemental"
    ? DEFAULT_SUPPLEMENTAL_INTERVAL_SECONDS
    : DEFAULT_PRIMARY_INTERVAL_SECONDS;
}

/** Deterministic capped exponential backoff (no jitter, so it is testable). */
export function failureBackoffSeconds(backoffLevel: number): number {
  if (backoffLevel <= 0) return 0;
  const exponent = Math.min(backoffLevel, 32);
  return Math.min(MAX_BACKOFF_SECONDS, BASE_BACKOFF_SECONDS * 2 ** (exponent - 1));
}

/** True when a source is eligible for auto-claim scheduling at all. */
export function isAutoClaimEligible(input: {
  automationPolicy: DiscoveryAutomationPolicy;
  lifecycleMode: DiscoverySourceLifecycleMode;
}): boolean {
  return (
    AUTO_CLAIM_POLICIES.includes(input.automationPolicy) &&
    CLAIMABLE_LIFECYCLE_MODES.includes(input.lifecycleMode)
  );
}

/**
 * Computes the next `nextRunAt` for a discovery source, or `null` when the
 * source should not be scheduled (paused, not auto-claim-eligible, or a
 * designated fallback whose activation condition does not currently hold).
 *
 * Precedence: pause / eligibility / dormant fallback short-circuit to `null`.
 * Otherwise the interval is the base tier cadence, stretched for supplemental
 * sources, then taken as the MAX of the cadence, any failure backoff, and any
 * budget cooldown, and finally clamped to the observed cadence bounds.
 */
export function computeNextRunAt(input: ComputeNextRunAtInput): Date | null {
  if (input.paused) return null;
  if (!isAutoClaimEligible(input)) return null;
  if (input.fallback?.designated && !input.fallback.activated) return null;

  const tier = roleTier(input.role);
  let intervalSeconds = baseIntervalSeconds(input, tier);

  // Supplemental sources reconcile at a strictly lower frequency.
  if (tier === "supplemental") {
    intervalSeconds *= SUPPLEMENTAL_FREQUENCY_MULTIPLIER;
  }

  // Failure backoff dominates the cadence while a source keeps failing.
  const backoffSeconds = failureBackoffSeconds(input.backoffLevel ?? 0);
  if (backoffSeconds > intervalSeconds) intervalSeconds = backoffSeconds;

  // A budget-exhausted run is deferred by at least the cooldown.
  if (input.budgetExhausted) {
    const cooldown = input.budgetCooldownSeconds ?? DEFAULT_BUDGET_COOLDOWN_SECONDS;
    if (cooldown > intervalSeconds) intervalSeconds = cooldown;
  }

  // Clamp to the observed publication cadence bounds.
  const min = input.cadenceBounds?.minIntervalSeconds ?? 0;
  const max = input.cadenceBounds?.maxIntervalSeconds ?? Number.POSITIVE_INFINITY;
  intervalSeconds = clamp(intervalSeconds, min, max);

  return new Date(input.now.getTime() + intervalSeconds * SECOND_MS);
}
