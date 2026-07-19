/**
 * PURE bounded-historical-backfill policy (issue #1101, Phase 3.2).
 *
 * The decision core for an administrator-approved historical backfill, with NO
 * database, network, or clock access (pure-logic house style, mirroring
 * `candidate-review-policy.ts` / `trigger-mode.ts` / `classify.ts`). The thin
 * `backfill-commit.ts` / `backfill-query.ts` do the Prisma I/O and apply these
 * decisions under guarded transactions; this module owns only:
 *
 *   1. {@link resolveEffectiveBackfillBounds} — clamp a REQUESTED window + item
 *      count to the configured ceilings so an approval can NEVER become an
 *      unbounded archive crawl. The effective window is always a concrete,
 *      bounded interval whose span never exceeds `maxWindowDays`, and the
 *      effective item cap never exceeds `maxItemsCeiling`. Clamps are reported as
 *      sanitized warning CATEGORIES (never content).
 *   2. {@link decideBackfillReactivation} — whether ONE matching historical
 *      identity is eligible to be reactivated. Honors the governing invariant:
 *      an identity that already has (or had-then-lost) a public Article is NEVER
 *      reactivated; only the historical states the pipeline actually produces —
 *      OBSERVED_BASELINE (status BASELINE) and OBSERVED_SHADOW (status DISCOVERED
 *      + not observed-in-baseline) — are targets. (SKIPPED_OUTSIDE_WINDOW is a
 *      deferred target: nothing produces it yet — see the follow-up.)
 *   3. {@link decideBackfillLifecycle} — the pause / resume / cancel state
 *      machine (legality + idempotency), so pause/resume/retry stays idempotent
 *      and never widens the approved range.
 *
 * A backfill NEVER starts itself: a gap suggestion is only an input to a human
 * approval, which is the sole caller of the commit that creates a run.
 */
import { BackfillRunStatus, CrawlCandidateStatus } from "@prisma/client";

/**
 * The LOW job priority every backfill-enqueued candidate-ingest Job runs at. The
 * job claimer orders by `priority DESC`, so a strictly-negative band is always
 * claimed AFTER real-time incremental work (priority 0), which — together with
 * the rate governor's `backfill` reserved-slot tier — guarantees historical
 * backfill can never starve new-article ingestion (contention AC).
 */
export const BACKFILL_JOB_PRIORITY = -100;

/** One UTC day in milliseconds (window-span math). */
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Effective bounds (clamp an approval to the configured ceilings)
// ---------------------------------------------------------------------------

/** Configured ceilings a requested backfill is clamped to. */
export type BackfillBoundsConfig = {
  /** Hard cap on how many identities one run may reactivate (≥ 1). */
  maxItemsCeiling: number;
  /** Hard cap on the effective window SPAN in days (≥ 1). */
  maxWindowDays: number;
};

/** The bounds as SUBMITTED by the administrator (window bounds may be open). */
export type RequestedBackfillBounds = {
  /** Inclusive window start (publication date). `null` = unbounded past. */
  windowStart: Date | null;
  /** Inclusive window end (publication date). `null` = up to `now`. */
  windowEnd: Date | null;
  /** Requested maximum identities to reactivate. */
  maxItems: number;
};

/**
 * The clamped bounds the run actually enforces. Both window edges are RESOLVED
 * to concrete dates (an open request is bounded to a `maxWindowDays` interval
 * ending at `now`), and `maxItems` never exceeds the ceiling. Resume/retry
 * re-reads these, so the approved range can never widen.
 */
export type EffectiveBackfillBounds = {
  windowStart: Date;
  windowEnd: Date;
  maxItems: number;
};

/** Sanitized clamp categories surfaced to the operator (never content). */
export type BackfillBoundsWarning =
  | "clamped-max-items"
  | "clamped-window-span"
  | "defaulted-window-end";

/** Why a requested backfill is rejected before any run is created. */
export type BackfillBoundsError =
  | "invalid-max-items"
  | "invalid-window-order";

/** Outcome of {@link resolveEffectiveBackfillBounds}. */
export type BackfillBoundsResult =
  | { ok: true; effective: EffectiveBackfillBounds; warnings: BackfillBoundsWarning[] }
  | { ok: false; reason: BackfillBoundsError };

/**
 * Clamps a requested backfill to the configured ceilings, returning the concrete
 * effective bounds + sanitized warnings, or a typed rejection for an invalid
 * request. Deterministic: `now` is injected (no clock read).
 *
 * Rules:
 *  - `maxItems` must be an integer ≥ 1, else `invalid-max-items`; it is clamped
 *    DOWN to `maxItemsCeiling` (warning `clamped-max-items`).
 *  - The window END defaults to `now` when open (warning `defaulted-window-end`);
 *    a future end is pulled back to `now` (same warning) — you cannot backfill
 *    the future.
 *  - An explicit start AFTER the effective end is `invalid-window-order`.
 *  - An open start, or a span wider than `maxWindowDays`, is bounded by moving
 *    the start forward to `end - maxWindowDays` (warning `clamped-window-span`).
 */
export function resolveEffectiveBackfillBounds(
  requested: RequestedBackfillBounds,
  config: BackfillBoundsConfig,
  now: Date,
): BackfillBoundsResult {
  const warnings: BackfillBoundsWarning[] = [];

  if (!Number.isInteger(requested.maxItems) || requested.maxItems < 1) {
    return { ok: false, reason: "invalid-max-items" };
  }

  const ceiling = Math.max(1, Math.floor(config.maxItemsCeiling));
  let maxItems = requested.maxItems;
  if (maxItems > ceiling) {
    maxItems = ceiling;
    warnings.push("clamped-max-items");
  }

  // Resolve the window END: open or future ⇒ now (cannot backfill the future).
  let windowEnd = requested.windowEnd;
  if (windowEnd === null) {
    windowEnd = now;
    warnings.push("defaulted-window-end");
  } else if (windowEnd.getTime() > now.getTime()) {
    windowEnd = now;
    warnings.push("defaulted-window-end");
  }

  if (requested.windowStart !== null && requested.windowStart.getTime() > windowEnd.getTime()) {
    return { ok: false, reason: "invalid-window-order" };
  }

  const maxSpanMs = Math.max(1, Math.floor(config.maxWindowDays)) * DAY_MS;
  const earliestAllowedStart = new Date(windowEnd.getTime() - maxSpanMs);

  let windowStart: Date;
  if (requested.windowStart === null) {
    // Open past ⇒ bound to the widest allowed span ending at the effective end.
    windowStart = earliestAllowedStart;
    warnings.push("clamped-window-span");
  } else if (requested.windowStart.getTime() < earliestAllowedStart.getTime()) {
    windowStart = earliestAllowedStart;
    warnings.push("clamped-window-span");
  } else {
    windowStart = requested.windowStart;
  }

  return { ok: true, effective: { windowStart, windowEnd, maxItems }, warnings };
}

// ---------------------------------------------------------------------------
// Reactivation eligibility (per matching identity)
// ---------------------------------------------------------------------------

/** Which historical state a reactivated identity was matched from. */
export type BackfillReactivationTarget = "observed-baseline" | "observed-shadow";

/** Why a matched identity is NOT reactivated (sanitized category). */
export type BackfillReactivationIneligibleReason =
  | "has-article"
  | "article-deleted"
  | "not-reactivatable";

/** Inputs the reactivation decision reads — all metadata, no identities/URLs. */
export type BackfillReactivationInput = {
  status: CrawlCandidateStatus;
  /** True when the identity was first seen during the source baseline. */
  observedInBaseline: boolean;
  /** True when the candidate currently links a public Article. */
  hasArticle: boolean;
  /** True when the candidate's Article was created then DELETED (SetNull). */
  hadArticleDeleted: boolean;
};

/** Outcome of {@link decideBackfillReactivation}. */
export type BackfillReactivationDecision =
  | { eligible: true; target: BackfillReactivationTarget }
  | { eligible: false; reason: BackfillReactivationIneligibleReason };

/**
 * Decides whether ONE matching historical identity may be reactivated by an
 * approved backfill. Governing invariant first: a KNOWN public Article (present
 * OR previously created-and-deleted) is NEVER recreated/revived by backfill.
 * Only the historical states the pipeline actually produces are targets —
 * OBSERVED_BASELINE (status BASELINE) and OBSERVED_SHADOW (status DISCOVERED,
 * not observed-in-baseline). Every other status (terminal, parked, conflicted,
 * already-queued, rejected) is ineligible. Deterministic + side-effect free.
 */
export function decideBackfillReactivation(
  input: BackfillReactivationInput,
): BackfillReactivationDecision {
  if (input.hasArticle) return { eligible: false, reason: "has-article" };
  if (input.hadArticleDeleted) return { eligible: false, reason: "article-deleted" };

  if (input.status === CrawlCandidateStatus.BASELINE) {
    return { eligible: true, target: "observed-baseline" };
  }
  if (input.status === CrawlCandidateStatus.DISCOVERED && !input.observedInBaseline) {
    return { eligible: true, target: "observed-shadow" };
  }
  return { eligible: false, reason: "not-reactivatable" };
}

// ---------------------------------------------------------------------------
// Lifecycle state machine (pause / resume / cancel)
// ---------------------------------------------------------------------------

/** The three operator control actions on a backfill run. */
export const BACKFILL_CONTROL_ACTIONS = ["pause", "resume", "cancel"] as const;
export type BackfillControlAction = (typeof BACKFILL_CONTROL_ACTIONS)[number];

/** Idempotent no-op reason codes (the control was already effectively applied). */
export type BackfillLifecycleNoopReason =
  | "already-paused"
  | "already-running"
  | "already-cancelled";

/** Illegal-transition reason codes (sanitized categories). */
export type BackfillLifecycleIllegalReason =
  | "not-active"
  | "not-paused"
  | "already-terminal";

/** Outcome of {@link decideBackfillLifecycle}. */
export type BackfillLifecycleDecision =
  | { kind: "apply"; action: BackfillControlAction; fromStatus: BackfillRunStatus; toStatus: BackfillRunStatus }
  | { kind: "noop"; action: BackfillControlAction; reason: BackfillLifecycleNoopReason; status: BackfillRunStatus }
  | { kind: "illegal"; action: BackfillControlAction; reason: BackfillLifecycleIllegalReason; status: BackfillRunStatus };

const RS = BackfillRunStatus;

/** Terminal run statuses — no control action changes them. */
const TERMINAL_RUN_STATUSES: readonly BackfillRunStatus[] = [RS.COMPLETED, RS.CANCELLED, RS.FAILED];

/**
 * Decides the legality + idempotency of one control action on a run. Pure.
 *
 *   RUNNING --pause---> PAUSED       PAUSED --resume--> RUNNING
 *   {RUNNING,PAUSED} --cancel--> CANCELLED   (terminal)
 *
 * A repeat of an already-applied control is an idempotent no-op (so pause/resume
 * stays idempotent); anything else on a terminal run is illegal.
 */
export function decideBackfillLifecycle(
  status: BackfillRunStatus,
  action: BackfillControlAction,
): BackfillLifecycleDecision {
  switch (action) {
    case "pause":
      if (status === RS.RUNNING) return { kind: "apply", action, fromStatus: status, toStatus: RS.PAUSED };
      if (status === RS.PAUSED) return { kind: "noop", action, reason: "already-paused", status };
      return { kind: "illegal", action, reason: "not-active", status };

    case "resume":
      if (status === RS.PAUSED) return { kind: "apply", action, fromStatus: status, toStatus: RS.RUNNING };
      if (status === RS.RUNNING) return { kind: "noop", action, reason: "already-running", status };
      return { kind: "illegal", action, reason: "not-paused", status };

    case "cancel":
      if (status === RS.RUNNING || status === RS.PAUSED) {
        return { kind: "apply", action, fromStatus: status, toStatus: RS.CANCELLED };
      }
      if (status === RS.CANCELLED) return { kind: "noop", action, reason: "already-cancelled", status };
      return { kind: "illegal", action, reason: "already-terminal", status };

    default:
      return { kind: "illegal", action, reason: "already-terminal", status: TERMINAL_RUN_STATUSES[0] };
  }
}
