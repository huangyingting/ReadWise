/**
 * PURE hostname/provider rate-governor clock (issue #1094, Phase 2.4).
 *
 * This module contains NO database, network, wall-clock, or randomness access.
 * Given an injected `now: Date` and plain metadata-only snapshots — per-hostname
 * in-flight counts, last-request timestamps, daily counts and pause state;
 * per-provider quotas, pending-candidate counts and priority tiers; the separate
 * discovery/body/AI cost-budget ledgers; and the candidate-backlog size — it
 * returns the governing decisions:
 *
 *   - {@link admitHostnameRequest} — admit / defer(reason,retryAt) / paused(until)
 *     for ONE request against the SHARED per-hostname budget (discovery RSS/
 *     sitemap AND article-body share the same concurrency, min-interval, and
 *     daily ceiling), enforcing the incremental reserved-slot floor so backfill
 *     can never starve real-time work (AC1, AC-priority).
 *   - {@link applyResponseSignal} — honor a server `Retry-After` and auto back
 *     off / pause a hostname after a configured 429/403/5xx pattern; reset on
 *     success (AC3).
 *   - {@link selectNextProvider} / {@link selectEligibleProviders} — fair
 *     scheduling so one high-volume provider cannot monopolize global workers;
 *     incremental outranks backfill, then fewest in-flight (fairness), then
 *     FIFO (oldest pending) within a provider for equal priority (AC2).
 *   - {@link classifyCostBudget} / {@link admitCostlyWork} — the three budgets
 *     are tracked independently; exhausting the body/AI budget DEFERS expensive
 *     work but NEVER stops low-cost discovery + candidate persistence (AC3/req6).
 *   - {@link evaluateBacklog} — throttle low-priority source frequency and raise
 *     an alert as the candidate backlog approaches capacity; candidates are never
 *     dropped (this is a signal only) (req7).
 *
 * Keeping every rule here (like `schedule.ts` / `frontier.ts` / `ingest-outcome.ts`)
 * makes each input separately fake-clock unit-testable and guarantees the thin
 * persistence/claim/discovery layers cannot re-implement the governing rules.
 *
 * PRIVACY: every input and output is a controlled count, timestamp, duration,
 * enum, or machine reason code — NEVER a URL, body, secret, cookie, or auth
 * detail. Hostname/provider KEYS are opaque sanitized strings supplied by the
 * caller and are not rendered here.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Request taxonomy
// ---------------------------------------------------------------------------

/**
 * The two request classes that SHARE one hostname budget. `discovery` is the
 * cheap RSS/sitemap poll; `body` is the expensive article-body fetch. They are
 * governed together for hostname concurrency/interval/ceiling but drawn from
 * SEPARATE cost budgets (see {@link CostBudgetKind}).
 */
export type RequestClass = "discovery" | "body";

/**
 * Work priority tier. `incremental` is real-time new-article ingestion; it
 * outranks `backfill` (historical work) everywhere and holds the reserved
 * hostname slots so backfill can never starve it.
 */
export type PriorityTier = "incremental" | "backfill";

/** The three independently-tracked cost budgets. */
export type CostBudgetKind = "discovery" | "body" | "ai";

// ---------------------------------------------------------------------------
// Hostname admission (AC1 + priority reservation)
// ---------------------------------------------------------------------------

/** Shared per-hostname budget configuration. `0` means unlimited/disabled. */
export type HostnameBudgetConfig = {
  /** Max simultaneous in-flight requests (discovery + body). 0 = unlimited. */
  maxConcurrency: number;
  /** Minimum interval between two requests to the host (ms). 0 = disabled. */
  minIntervalMs: number;
  /** Per-UTC-day request ceiling (discovery + body). 0 = unlimited. */
  dailyCeiling: number;
};

/** Hostname-concurrency slots reserved for real-time incremental work. */
export type ReservationConfig = {
  /** Slots reserved for incremental; clamped to `maxConcurrency`. 0 = disabled. */
  incrementalReservedSlots: number;
};

/**
 * Metadata-only snapshot of a hostname's current budget state. `inFlight` is the
 * SHARED discovery+body in-flight count (derived from leased sources / locked
 * jobs by the thin layer); `dailyCount` is requests already made in the current
 * UTC day; `pausedUntil` is any active auto-pause / `Retry-After` window.
 */
export type HostnameBudgetSnapshot = {
  inFlight: number;
  lastRequestAt: Date | null;
  dailyCount: number;
  pausedUntil: Date | null;
};

/** Machine reason a request was NOT admitted (never a URL / body). */
export type DeferReason =
  | "concurrency"
  | "min-interval"
  | "daily-ceiling"
  | "reserved-for-incremental";

/**
 * Result of {@link admitHostnameRequest}. `defer` carries the earliest time the
 * request could be retried (or `null` when it depends on an in-flight slot
 * freeing, which has no fixed time); `paused` carries the pause expiry.
 */
export type AdmissionDecision =
  | { decision: "admit" }
  | { decision: "defer"; reason: DeferReason; retryAt: Date | null }
  | { decision: "paused"; until: Date };

export type HostnameAdmissionInput = {
  now: Date;
  requestClass: RequestClass;
  priorityTier: PriorityTier;
  snapshot: HostnameBudgetSnapshot;
  config: HostnameBudgetConfig;
  reservation: ReservationConfig;
};

/** Start of the UTC day AFTER `now` — when a daily counter resets. */
export function nextUtcDayReset(now: Date): Date {
  const d = new Date(now.getTime());
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() + DAY_MS);
}

/** UTC-day key ("YYYY-MM-DD") a timestamp falls in — the daily-window bucket. */
export function utcDayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Effective concurrency a request may consume. Incremental work may use the full
 * `maxConcurrency`; backfill may only use `maxConcurrency - reservedSlots`, so at
 * least `reservedSlots` are ALWAYS available for real-time incremental work.
 */
function effectiveConcurrencyLimit(input: HostnameAdmissionInput): number {
  const { config, reservation, priorityTier } = input;
  if (config.maxConcurrency <= 0) return Number.POSITIVE_INFINITY;
  if (priorityTier === "incremental") return config.maxConcurrency;
  const reserved = Math.max(0, Math.min(reservation.incrementalReservedSlots, config.maxConcurrency));
  return Math.max(0, config.maxConcurrency - reserved);
}

/**
 * Decides whether ONE request may be made to a hostname RIGHT NOW under the
 * shared budget. Precedence (deterministic):
 *   1. an active pause (`Retry-After` / auto-backoff) → `paused`;
 *   2. the daily ceiling is reached → `defer` (retry at the next UTC day);
 *   3. the min-interval since the last request has not elapsed → `defer`;
 *   4. the effective concurrency limit is reached → `defer`
 *      (`reserved-for-incremental` when backfill is blocked purely by the
 *      reservation floor, else `concurrency`);
 *   5. otherwise → `admit`.
 *
 * Because backfill's effective limit excludes the reserved slots, a burst of
 * backfill can never consume the capacity real-time incrementation needs.
 */
export function admitHostnameRequest(input: HostnameAdmissionInput): AdmissionDecision {
  const { now, snapshot, config } = input;

  if (snapshot.pausedUntil && snapshot.pausedUntil.getTime() > now.getTime()) {
    return { decision: "paused", until: snapshot.pausedUntil };
  }

  if (config.dailyCeiling > 0 && snapshot.dailyCount >= config.dailyCeiling) {
    return { decision: "defer", reason: "daily-ceiling", retryAt: nextUtcDayReset(now) };
  }

  if (config.minIntervalMs > 0 && snapshot.lastRequestAt) {
    const readyAt = new Date(snapshot.lastRequestAt.getTime() + config.minIntervalMs);
    if (readyAt.getTime() > now.getTime()) {
      return { decision: "defer", reason: "min-interval", retryAt: readyAt };
    }
  }

  const limit = effectiveConcurrencyLimit(input);
  if (snapshot.inFlight >= limit) {
    // Distinguish "blocked purely by the incremental reservation" from a genuine
    // saturation so metrics/tests can prove the reservation is what held backfill.
    const blockedByReservation =
      input.priorityTier === "backfill" &&
      config.maxConcurrency > 0 &&
      snapshot.inFlight < config.maxConcurrency;
    return {
      decision: "defer",
      reason: blockedByReservation ? "reserved-for-incremental" : "concurrency",
      retryAt: null,
    };
  }

  return { decision: "admit" };
}

// ---------------------------------------------------------------------------
// Backoff / pause on 429 / 403 / 5xx + Retry-After (AC3)
// ---------------------------------------------------------------------------

/** Auto-pause tuning. `errorThreshold`/`basePauseMs`/`maxPauseMs`; 0 disables. */
export type BackoffConfig = {
  /** Consecutive throttle responses before a threshold-pause; 0 disables it. */
  errorThreshold: number;
  /** Base pause once the threshold is crossed (ms). */
  basePauseMs: number;
  /** Maximum pause (ms). */
  maxPauseMs: number;
};

/** Cross-day per-hostname health state the persistence layer stores. */
export type HostnameHealthState = {
  consecutiveErrors: number;
  pausedUntil: Date | null;
  lastFailureReason: string | null;
};

/** A normalized response signal (metadata only — never a body). */
export type ResponseSignal =
  | { kind: "ok" }
  | { kind: "http-status"; status: number; retryAfterMs?: number }
  | { kind: "network-error" };

/** Machine reason codes recorded for a hostname pause (never a URL/body). */
export const HOST_PAUSE_REASON = {
  RETRY_AFTER: "retry_after",
  HTTP_429: "http_429",
  HTTP_403: "http_403",
  HTTP_5XX: "http_5xx",
} as const;

export type HostPauseReason = (typeof HOST_PAUSE_REASON)[keyof typeof HOST_PAUSE_REASON];

/** True when an HTTP status is a throttle/backoff signal (429 / 403 / 5xx). */
export function isThrottleStatus(status: number): boolean {
  return status === 429 || status === 403 || (status >= 500 && status < 600);
}

function pauseReasonForStatus(status: number): HostPauseReason {
  if (status === 429) return HOST_PAUSE_REASON.HTTP_429;
  if (status === 403) return HOST_PAUSE_REASON.HTTP_403;
  return HOST_PAUSE_REASON.HTTP_5XX;
}

/** Capped exponential threshold-pause (jitter-free, so it is testable). */
function thresholdPauseMs(errorsOverThreshold: number, config: BackoffConfig): number {
  const exponent = Math.min(Math.max(0, errorsOverThreshold), 20);
  return Math.min(config.maxPauseMs, config.basePauseMs * 2 ** exponent);
}

/**
 * Applies a response signal to a hostname's health, honoring a server
 * `Retry-After` and auto-pausing after a configured throttle pattern.
 *
 *   - `ok`               → reset the error streak and CLEAR any pause.
 *   - `Retry-After`      → pause immediately for exactly that long (the origin
 *                          knows best), regardless of the streak.
 *   - 429 / 403 / 5xx    → increment the streak; once it reaches `errorThreshold`
 *                          apply a capped exponential pause.
 *   - other HTTP / net   → surface the failure but do not pause (a 404/permanent
 *                          error is the ingest classifier's job, not the host's).
 *
 * PURE: identical inputs + `now` always yield identical output.
 */
export function applyResponseSignal(params: {
  now: Date;
  signal: ResponseSignal;
  state: HostnameHealthState;
  config: BackoffConfig;
}): HostnameHealthState {
  const { now, signal, state, config } = params;

  if (signal.kind === "ok") {
    return { consecutiveErrors: 0, pausedUntil: null, lastFailureReason: null };
  }

  if (signal.kind === "network-error") {
    // A transport failure counts toward the streak but never carries Retry-After.
    return maybePauseOnStreak(now, state.consecutiveErrors + 1, HOST_PAUSE_REASON.HTTP_5XX, undefined, config);
  }

  const { status, retryAfterMs } = signal;
  if (!isThrottleStatus(status)) {
    // Non-throttle HTTP (e.g. 404/410): do not touch the host pause/streak.
    return state;
  }

  const reason = pauseReasonForStatus(status);
  const nextErrors = state.consecutiveErrors + 1;

  if (retryAfterMs !== undefined && retryAfterMs >= 0) {
    return {
      consecutiveErrors: nextErrors,
      pausedUntil: new Date(now.getTime() + retryAfterMs),
      lastFailureReason: HOST_PAUSE_REASON.RETRY_AFTER,
    };
  }

  return maybePauseOnStreak(now, nextErrors, reason, retryAfterMs, config);
}

function maybePauseOnStreak(
  now: Date,
  nextErrors: number,
  reason: HostPauseReason,
  retryAfterMs: number | undefined,
  config: BackoffConfig,
): HostnameHealthState {
  if (config.errorThreshold > 0 && nextErrors >= config.errorThreshold) {
    const pauseMs = thresholdPauseMs(nextErrors - config.errorThreshold, config);
    return {
      consecutiveErrors: nextErrors,
      pausedUntil: new Date(now.getTime() + pauseMs),
      lastFailureReason: reason,
    };
  }
  return { consecutiveErrors: nextErrors, pausedUntil: null, lastFailureReason: reason };
}

// ---------------------------------------------------------------------------
// Provider fairness / no-starvation (AC2)
// ---------------------------------------------------------------------------

/** Per-provider metadata-only snapshot used for fair scheduling. */
export type ProviderState = {
  providerKey: string;
  /** Highest-priority tier this provider currently has READY work in. */
  priorityTier: PriorityTier;
  /** Ready candidates waiting to be served for this provider. */
  pendingCandidates: number;
  /** Shared discovery+body in-flight requests for this provider. */
  inFlight: number;
  /** Per-UTC-day quota; 0 = unlimited. */
  dailyQuota: number;
  /** Requests already made this UTC day for the provider. */
  dailyCount: number;
  /** Oldest pending candidate's observation time (FIFO tiebreak); null when none. */
  oldestPendingAt: Date | null;
};

/** True when a provider has ready work AND is under its daily quota. */
export function isProviderEligible(provider: ProviderState): boolean {
  if (provider.pendingCandidates <= 0) return false;
  if (provider.dailyQuota > 0 && provider.dailyCount >= provider.dailyQuota) return false;
  return true;
}

/** The eligible provider subset (ready work, under quota), order-preserved. */
export function selectEligibleProviders(providers: readonly ProviderState[]): ProviderState[] {
  return providers.filter(isProviderEligible);
}

const TIER_RANK: Record<PriorityTier, number> = { incremental: 0, backfill: 1 };

/**
 * Deterministic fair-scheduling comparator (lower sorts first / higher priority):
 *   1. incremental tier before backfill;
 *   2. FEWEST in-flight — the fairness lever: a high-volume provider that already
 *      saturated global workers yields to another provider with ready work, so it
 *      cannot indefinitely starve peers;
 *   3. OLDEST pending (FIFO within a provider / across equal-priority peers);
 *   4. providerKey — a stable final tiebreak.
 */
export function compareProviderFairness(a: ProviderState, b: ProviderState): number {
  const tier = TIER_RANK[a.priorityTier] - TIER_RANK[b.priorityTier];
  if (tier !== 0) return tier;

  if (a.inFlight !== b.inFlight) return a.inFlight - b.inFlight;

  const aOld = a.oldestPendingAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const bOld = b.oldestPendingAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (aOld !== bOld) return aOld - bOld;

  return a.providerKey < b.providerKey ? -1 : a.providerKey > b.providerKey ? 1 : 0;
}

/**
 * Picks the SINGLE next provider to serve (or `null` when none is eligible),
 * applying {@link compareProviderFairness}. Because "fewest in-flight" beats raw
 * volume, repeatedly serving the winner naturally rotates work across providers
 * (AC2: no provider is starved while it has ready incremental candidates).
 */
export function selectNextProvider(providers: readonly ProviderState[]): ProviderState | null {
  const eligible = selectEligibleProviders(providers);
  if (eligible.length === 0) return null;
  return [...eligible].sort(compareProviderFairness)[0];
}

/**
 * The ordered eligible provider keys the claim query should be pre-filtered
 * against (fairness order). The thin layer scopes the atomic claim to this set
 * so the PostgreSQL `FOR UPDATE SKIP LOCKED` claim is never rewritten.
 */
export function fairProviderOrder(providers: readonly ProviderState[]): string[] {
  return selectEligibleProviders(providers)
    .sort(compareProviderFairness)
    .map((p) => p.providerKey);
}

// ---------------------------------------------------------------------------
// Separate cost budgets + exhaustion behavior (req5 / req6)
// ---------------------------------------------------------------------------

/** A single cost-budget ledger for a UTC day. `dailyBudget` 0 = unlimited. */
export type CostBudgetLedger = {
  kind: CostBudgetKind;
  used: number;
  dailyBudget: number;
};

export type CostBudgetStatus = {
  kind: CostBudgetKind;
  exhausted: boolean;
  remaining: number | null;
};

/** Classifies a single cost budget as exhausted (used ≥ budget) or not. */
export function classifyCostBudget(ledger: CostBudgetLedger): CostBudgetStatus {
  if (ledger.dailyBudget <= 0) {
    return { kind: ledger.kind, exhausted: false, remaining: null };
  }
  const remaining = Math.max(0, ledger.dailyBudget - ledger.used);
  return { kind: ledger.kind, exhausted: remaining <= 0, remaining };
}

/** The three independent budget ledgers for a UTC day. */
export type CostBudgetSnapshot = {
  discovery: CostBudgetLedger;
  body: CostBudgetLedger;
  ai: CostBudgetLedger;
};

/**
 * Decides whether a unit of work of `requestClass` may run under the cost
 * budgets. The governing rule (req6 + non-goal): DISCOVERY always runs while its
 * own budget remains — it is never stopped merely because the body or AI budget
 * is exhausted. BODY work is deferred when the body budget is exhausted; the
 * candidates it would have processed stay durable and are resumed (oldest first)
 * when capacity returns.
 */
export function admitCostlyWork(params: {
  requestClass: RequestClass;
  budgets: CostBudgetSnapshot;
}): { admit: boolean; deferredBudget: CostBudgetKind | null } {
  const { requestClass, budgets } = params;
  const ledger = requestClass === "discovery" ? budgets.discovery : budgets.body;
  const status = classifyCostBudget(ledger);
  if (status.exhausted) {
    return { admit: false, deferredBudget: ledger.kind };
  }
  return { admit: true, deferredBudget: null };
}

/**
 * True when AI/narration downstream work should be deferred. Separate from
 * {@link admitCostlyWork} because exhausting AI budget NEVER blocks discovery or
 * body fetch — only the optional AI/narration step is deferred.
 */
export function isAiBudgetExhausted(budgets: CostBudgetSnapshot): boolean {
  return classifyCostBudget(budgets.ai).exhausted;
}

// ---------------------------------------------------------------------------
// Backlog throttle + alert (req7)
// ---------------------------------------------------------------------------

/** Backlog throttle configuration. `capacityThreshold` 0 = disabled. */
export type BacklogConfig = {
  capacityThreshold: number;
  /**
   * Fraction of the threshold at which throttling ENGAGES (default 0.8). At/above
   * this the low-priority source cadence is stretched and an alert is raised.
   */
  engageAtFraction?: number;
  /** Cadence multiplier applied to low-priority sources while throttling. */
  throttleMultiplier?: number;
};

export type BacklogSignal = {
  /** Reduce low-priority (supplemental/backfill) source frequency. */
  throttle: boolean;
  /** Emit an operator alert (backlog approaching / at capacity). */
  alert: boolean;
  /** Cadence multiplier to apply to low-priority sources (1 = unchanged). */
  frequencyMultiplier: number;
  /** backlogSize / capacityThreshold (null when disabled). */
  utilization: number | null;
};

const DEFAULT_ENGAGE_FRACTION = 0.8;
const DEFAULT_THROTTLE_MULTIPLIER = 4;

/**
 * Evaluates the candidate backlog against its capacity threshold. When the
 * backlog reaches the engage fraction of the threshold, low-priority source
 * frequency is reduced (a larger cadence multiplier) and an alert is raised.
 * This NEVER deletes or drops candidates — it only slows fresh low-priority
 * discovery so the backlog can drain (req7).
 */
export function evaluateBacklog(params: {
  backlogSize: number;
  config: BacklogConfig;
}): BacklogSignal {
  const { backlogSize, config } = params;
  if (config.capacityThreshold <= 0) {
    return { throttle: false, alert: false, frequencyMultiplier: 1, utilization: null };
  }
  const engageAt = (config.engageAtFraction ?? DEFAULT_ENGAGE_FRACTION) * config.capacityThreshold;
  const utilization = backlogSize / config.capacityThreshold;
  if (backlogSize >= engageAt) {
    return {
      throttle: true,
      alert: true,
      frequencyMultiplier: config.throttleMultiplier ?? DEFAULT_THROTTLE_MULTIPLIER,
      utilization,
    };
  }
  return { throttle: false, alert: false, frequencyMultiplier: 1, utilization };
}
