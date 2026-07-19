/**
 * THIN guarded persistence for the rate governor (#1094, Phase 2.4).
 *
 * Wires the PURE decisions in `rate-governor.ts` to the two durable stores
 * (`ScraperBudgetWindow` per-UTC-day counters + `HostnameGovernorState` cross-day
 * host state) using the house guarded-update concurrency pattern: reads happen
 * BEFORE the transaction, a single interactive `$transaction` re-validates state,
 * and idempotent counter increments use `upsert` (INSERT..ON CONFLICT) — NEVER a
 * catch-P2002-inside-a-tx (which would poison a PostgreSQL transaction). A guard
 * that no longer holds throws {@link ReservationConflictError} and rolls the whole
 * transaction back, so a lost concurrency race yields a `defer`, never an
 * over-count. This mirrors `ingest-recovery.ts` / `page-commit.ts` / claim.
 *
 * Durability split (documented tradeoff): in-flight CONCURRENCY is derived by the
 * caller from currently-leased sources / locked jobs (ephemeral, self-healing
 * across restart), so it is passed into the pure decision and is NOT stored here.
 * The daily request ceiling, per-provider daily quota, cost budgets, min-interval
 * anchor, and auto-pause window MUST survive restart and span UTC-day boundaries,
 * so they live in the two tables above. The daily ceiling / budget caps are
 * re-validated inside the tx AFTER the atomic increment (over-count → rollback);
 * min-interval and pause are re-validated inside the tx before committing.
 *
 * PRIVACY: only opaque sanitized host/provider keys, counts, timestamps, and
 * machine reason codes are read or written — never a URL, body, secret, or cookie.
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import {
  admitHostnameRequest,
  applyResponseSignal,
  classifyCostBudget,
  utcDayKey,
  type AdmissionDecision,
  type BackoffConfig,
  type CostBudgetKind,
  type HostnameBudgetConfig,
  type HostnameBudgetSnapshot,
  type HostnameHealthState,
  type PriorityTier,
  type RequestClass,
  type ReservationConfig,
  type ResponseSignal,
} from "./rate-governor";

/** Durable {@link ScraperBudgetWindow} scope labels (machine strings). */
export const BUDGET_SCOPE = {
  HOSTNAME: "hostname",
  PROVIDER: "provider",
  DISCOVERY_BUDGET: "discovery_budget",
  BODY_BUDGET: "body_budget",
  AI_BUDGET: "ai_budget",
} as const;

/** The global cost-budget scopeKey (cost budgets are not per-host/provider). */
export const GLOBAL_BUDGET_KEY = "global";

const COST_BUDGET_SCOPE: Record<CostBudgetKind, string> = {
  discovery: BUDGET_SCOPE.DISCOVERY_BUDGET,
  body: BUDGET_SCOPE.BODY_BUDGET,
  ai: BUDGET_SCOPE.AI_BUDGET,
};

/** Signals a guard no longer held → roll the reservation transaction back. */
export class ReservationConflictError extends Error {
  readonly decision: AdmissionDecision;
  constructor(decision: AdmissionDecision) {
    super("rate-governor reservation guard matched no rows / exceeded a cap");
    this.name = "ReservationConflictError";
    this.decision = decision;
  }
}

type ClientOrTx = Pick<Prisma.TransactionClient, "scraperBudgetWindow" | "hostnameGovernorState">;

// ---------------------------------------------------------------------------
// Snapshot reads (BEFORE the transaction)
// ---------------------------------------------------------------------------

async function readWindowCount(
  client: ClientOrTx,
  scope: string,
  scopeKey: string,
  utcDay: string,
): Promise<number> {
  const row = await client.scraperBudgetWindow.findUnique({
    where: { scope_scopeKey_utcDay: { scope, scopeKey, utcDay } },
    select: { requestCount: true },
  });
  return row?.requestCount ?? 0;
}

async function readHostState(
  client: ClientOrTx,
  hostKey: string,
): Promise<HostnameHealthState & { lastRequestAt: Date | null }> {
  const row = await client.hostnameGovernorState.findUnique({ where: { hostKey } });
  return {
    consecutiveErrors: row?.consecutiveErrors ?? 0,
    pausedUntil: row?.pausedUntil ?? null,
    lastFailureReason: row?.lastFailureReason ?? null,
    lastRequestAt: row?.lastRequestAt ?? null,
  };
}

/** Reads a metadata-only hostname budget snapshot for a pure admission decision. */
export async function readHostnameBudgetSnapshot(params: {
  hostKey: string;
  inFlight: number;
  now: Date;
}): Promise<HostnameBudgetSnapshot> {
  const { hostKey, inFlight, now } = params;
  const [dailyCount, state] = await Promise.all([
    readWindowCount(prisma, BUDGET_SCOPE.HOSTNAME, hostKey, utcDayKey(now)),
    readHostState(prisma, hostKey),
  ]);
  return {
    inFlight,
    lastRequestAt: state.lastRequestAt,
    dailyCount,
    pausedUntil: state.pausedUntil,
  };
}

/** Atomic (INSERT..ON CONFLICT) +1 increment of a windowed counter; returns the new count. */
async function incrementWindow(
  tx: ClientOrTx,
  scope: string,
  scopeKey: string,
  utcDay: string,
  now: Date,
): Promise<number> {
  const row = await tx.scraperBudgetWindow.upsert({
    where: { scope_scopeKey_utcDay: { scope, scopeKey, utcDay } },
    create: { scope, scopeKey, utcDay, requestCount: 1, updatedAt: now },
    update: { requestCount: { increment: 1 }, updatedAt: now },
    select: { requestCount: true },
  });
  return row.requestCount;
}

// ---------------------------------------------------------------------------
// Hostname request reservation (AC1 + priority reservation)
// ---------------------------------------------------------------------------

export type ReserveHostnameRequestParams = {
  hostKey: string;
  /** SHARED discovery+body in-flight count derived from leased sources/locked jobs. */
  inFlight: number;
  requestClass: RequestClass;
  priorityTier: PriorityTier;
  config: HostnameBudgetConfig;
  reservation: ReservationConfig;
  now: Date;
};

/**
 * Attempts to RESERVE one hostname request slot. On `admit` it atomically bumps
 * the per-UTC-day counter and advances the min-interval anchor inside a single
 * transaction that re-validates the pause window, min-interval, and daily
 * ceiling; if any guard fails (a concurrent reservation won) the transaction
 * rolls back and the returned decision becomes a `defer`/`paused`. A non-admit
 * pure decision short-circuits WITHOUT a transaction (no counter is spent).
 */
export async function reserveHostnameRequest(
  params: ReserveHostnameRequestParams,
): Promise<AdmissionDecision> {
  const { hostKey, inFlight, requestClass, priorityTier, config, reservation, now } = params;
  const utcDay = utcDayKey(now);

  const snapshot = await readHostnameBudgetSnapshot({ hostKey, inFlight, now });
  const decision = admitHostnameRequest({
    now,
    requestClass,
    priorityTier,
    snapshot,
    config,
    reservation,
  });
  if (decision.decision !== "admit") return decision;

  try {
    return await prisma.$transaction(async (tx) => {
      // Re-validate pause + min-interval under the tx (cross-day host state).
      const state = await readHostState(tx, hostKey);
      const reDecision = admitHostnameRequest({
        now,
        requestClass,
        priorityTier,
        snapshot: {
          inFlight,
          lastRequestAt: state.lastRequestAt,
          dailyCount: snapshot.dailyCount,
          pausedUntil: state.pausedUntil,
        },
        config,
        reservation,
      });
      if (reDecision.decision !== "admit") throw new ReservationConflictError(reDecision);

      // Atomic increment, then guard the daily ceiling on the NEW count.
      const newCount = await incrementWindow(tx, BUDGET_SCOPE.HOSTNAME, hostKey, utcDay, now);
      if (config.dailyCeiling > 0 && newCount > config.dailyCeiling) {
        throw new ReservationConflictError({
          decision: "defer",
          reason: "daily-ceiling",
          retryAt: null,
        });
      }

      // Advance the min-interval anchor (preserve pause/error state).
      await tx.hostnameGovernorState.upsert({
        where: { hostKey },
        create: { hostKey, lastRequestAt: now, updatedAt: now },
        update: { lastRequestAt: now, updatedAt: now },
      });

      return { decision: "admit" } as const;
    });
  } catch (error) {
    if (error instanceof ReservationConflictError) return error.decision;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Cost-budget consumption (req5 / req6)
// ---------------------------------------------------------------------------

export type ConsumeCostBudgetResult =
  | { admitted: true; used: number; remaining: number | null }
  | { admitted: false; kind: CostBudgetKind };

/**
 * Consumes one unit of a cost budget (discovery/body/AI). Atomically increments
 * the per-UTC-day counter and rolls back (returning `admitted:false`) when the
 * increment would exceed the daily budget, so an exhausted budget defers the
 * expensive work while leaving already-persisted candidates untouched. A budget
 * of `0` is unlimited (always admitted).
 */
export async function consumeCostBudget(params: {
  kind: CostBudgetKind;
  dailyBudget: number;
  now: Date;
}): Promise<ConsumeCostBudgetResult> {
  const { kind, dailyBudget, now } = params;
  const scope = COST_BUDGET_SCOPE[kind];
  const utcDay = utcDayKey(now);

  if (dailyBudget <= 0) {
    const used = await incrementWindow(prisma, scope, GLOBAL_BUDGET_KEY, utcDay, now);
    return { admitted: true, used, remaining: null };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const newUsed = await incrementWindow(tx, scope, GLOBAL_BUDGET_KEY, utcDay, now);
      if (newUsed > dailyBudget) {
        throw new ReservationConflictError({
          decision: "defer",
          reason: "daily-ceiling",
          retryAt: null,
        });
      }
      return { admitted: true, used: newUsed, remaining: Math.max(0, dailyBudget - newUsed) } as const;
    });
  } catch (error) {
    if (error instanceof ReservationConflictError) return { admitted: false, kind };
    throw error;
  }
}

/** Reads a cost budget's current used/exhausted status (no mutation). */
export async function readCostBudgetStatus(params: {
  kind: CostBudgetKind;
  dailyBudget: number;
  now: Date;
}): Promise<{ used: number; exhausted: boolean; remaining: number | null }> {
  const { kind, dailyBudget, now } = params;
  const used = await readWindowCount(
    prisma,
    COST_BUDGET_SCOPE[kind],
    GLOBAL_BUDGET_KEY,
    utcDayKey(now),
  );
  const status = classifyCostBudget({ kind, used, dailyBudget });
  return { used, exhausted: status.exhausted, remaining: status.remaining };
}

// ---------------------------------------------------------------------------
// Per-provider daily quota (AC2 support)
// ---------------------------------------------------------------------------

/** Consumes one unit of a provider's daily quota (0 = unlimited). Same guard. */
export async function consumeProviderQuota(params: {
  providerKey: string;
  dailyQuota: number;
  now: Date;
}): Promise<{ admitted: boolean; used: number }> {
  const { providerKey, dailyQuota, now } = params;
  const utcDay = utcDayKey(now);

  if (dailyQuota <= 0) {
    const used = await incrementWindow(prisma, BUDGET_SCOPE.PROVIDER, providerKey, utcDay, now);
    return { admitted: true, used };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const used = await incrementWindow(tx, BUDGET_SCOPE.PROVIDER, providerKey, utcDay, now);
      if (used > dailyQuota) {
        throw new ReservationConflictError({ decision: "defer", reason: "daily-ceiling", retryAt: null });
      }
      return { admitted: true, used } as const;
    });
  } catch (error) {
    if (error instanceof ReservationConflictError) return { admitted: false, used: dailyQuota };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Response signal → auto-pause / backoff (AC3)
// ---------------------------------------------------------------------------

/**
 * Records a response signal for a hostname, honoring `Retry-After` and auto-
 * pausing after a configured 429/403/5xx pattern (or clearing on success). Uses
 * the pure {@link applyResponseSignal} then upserts the new cross-day state. This
 * is a standalone idempotent write (NOT inside a governing tx), so an upsert is
 * the correct atomic form.
 */
export async function recordHostnameResponse(params: {
  hostKey: string;
  signal: ResponseSignal;
  config: BackoffConfig;
  now: Date;
}): Promise<HostnameHealthState> {
  const { hostKey, signal, config, now } = params;
  const current = await readHostState(prisma, hostKey);
  const next = applyResponseSignal({
    now,
    signal,
    state: {
      consecutiveErrors: current.consecutiveErrors,
      pausedUntil: current.pausedUntil,
      lastFailureReason: current.lastFailureReason,
    },
    config,
  });

  await prisma.hostnameGovernorState.upsert({
    where: { hostKey },
    create: {
      hostKey,
      consecutiveErrors: next.consecutiveErrors,
      pausedUntil: next.pausedUntil,
      lastFailureReason: next.lastFailureReason,
      updatedAt: now,
    },
    update: {
      consecutiveErrors: next.consecutiveErrors,
      pausedUntil: next.pausedUntil,
      lastFailureReason: next.lastFailureReason,
      updatedAt: now,
    },
  });
  return next;
}

/** Reads a hostname's current pause/error state for observability (no mutation). */
export async function readHostnameGovernorState(hostKey: string): Promise<HostnameHealthState> {
  const state = await readHostState(prisma, hostKey);
  return {
    consecutiveErrors: state.consecutiveErrors,
    pausedUntil: state.pausedUntil,
    lastFailureReason: state.lastFailureReason,
  };
}
