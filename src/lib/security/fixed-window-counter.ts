/**
 * Fixed-window counter with shared-database and process-memory adapters.
 *
 * Consumers choose only the fallback window anchor required by their existing
 * policy. Store selection, atomic increments, expiry, sweeping, circuit
 * breaking, and best-effort mirroring remain hidden here.
 */

import { createLogger } from "@/lib/observability/logger";
import { prisma } from "@/lib/prisma";
import { rateLimitStoreMode } from "@/lib/runtime-config/rate-limit";

const log = createLogger("fixed-window-counter");
const FAILURE_COOLDOWN_MS = 30_000;
const EXPIRED_COUNTER_SWEEP_PROBABILITY = 0.05;

type CounterClient = {
  $transaction?: <R>(fn: (tx: CounterClient) => Promise<R>) => Promise<R>;
  rateLimitCounter: {
    upsert: (args: unknown) => Promise<{ count: number }>;
    deleteMany: (args: unknown) => Promise<unknown>;
  };
};

type MemoryBucket = {
  count: number;
  windowStart: number;
};

export type FallbackWindowAnchor = "epoch" | "first-hit";

export type ConsumeFixedWindowInput = {
  key: string;
  windowMs: number;
  nowMs?: number;
  fallbackWindowAnchor: FallbackWindowAnchor;
};

export type ConsumeFixedWindowBatchReservation = {
  key: string;
  limit: number;
};

export type ConsumeFixedWindowBatchInput = {
  reservations: ConsumeFixedWindowBatchReservation[];
  windowMs: number;
  nowMs?: number;
  fallbackWindowAnchor: FallbackWindowAnchor;
};

export type ConsumeFixedWindowBatchResult =
  | { allowed: true; counts: Map<string, number> }
  | {
      allowed: false;
      blocked: { key: string; limit: number; count: number };
      counts: Map<string, number>;
    };

export type ObserveFixedWindowInput = {
  key: string;
  windowMs: number;
  nowMs?: number;
};

const memoryBuckets = new Map<string, MemoryBucket>();
let databaseDisabledUntil = 0;
let mirrorDisabledUntil = 0;

function epochWindowStart(nowMs: number, windowMs: number): number {
  return Math.floor(nowMs / windowMs) * windowMs;
}

function databaseEnabled(nowMs: number): boolean {
  const mode = rateLimitStoreMode();
  if (mode === "memory") return false;
  if (mode === "auto" && nowMs < databaseDisabledUntil) return false;
  return true;
}

function purgeStaleMemory(nowMs: number, windowMs: number): void {
  const cutoff = nowMs - windowMs * 2;
  for (const [key, bucket] of memoryBuckets) {
    if (bucket.windowStart < cutoff) memoryBuckets.delete(key);
  }
}

function incrementMemory(
  key: string,
  windowMs: number,
  nowMs: number,
  anchor: FallbackWindowAnchor,
): number {
  if (Math.random() < EXPIRED_COUNTER_SWEEP_PROBABILITY) {
    purgeStaleMemory(nowMs, windowMs);
  }

  const expectedStart =
    anchor === "epoch" ? epochWindowStart(nowMs, windowMs) : undefined;
  const bucket = memoryBuckets.get(key);
  const expired = bucket
    ? anchor === "epoch"
      ? bucket.windowStart !== expectedStart
      : nowMs - bucket.windowStart >= windowMs
    : true;

  if (!bucket || expired) {
    memoryBuckets.set(key, {
      count: 1,
      windowStart: expectedStart ?? nowMs,
    });
    return 1;
  }

  bucket.count += 1;
  return bucket.count;
}

function nextMemoryCount(
  key: string,
  windowMs: number,
  nowMs: number,
  anchor: FallbackWindowAnchor,
): number {
  const expectedStart =
    anchor === "epoch" ? epochWindowStart(nowMs, windowMs) : undefined;
  const bucket = memoryBuckets.get(key);
  const expired = bucket
    ? anchor === "epoch"
      ? bucket.windowStart !== expectedStart
      : nowMs - bucket.windowStart >= windowMs
    : true;
  return !bucket || expired ? 1 : bucket.count + 1;
}

function sweepExpiredDatabaseCounters(client: CounterClient): void {
  if (Math.random() >= EXPIRED_COUNTER_SWEEP_PROBABILITY) return;
  void client.rateLimitCounter
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch(() => {});
}

function tripDatabaseCircuit(_err: unknown): void {
  databaseDisabledUntil = Date.now() + FAILURE_COOLDOWN_MS;
  log.warn("fixed_window_counter.database_unavailable", {
    machineReason: "counter_database_unavailable",
    cooldownMs: FAILURE_COOLDOWN_MS,
  });
}

class FixedWindowLimitExceeded extends Error {
  readonly key: string;
  readonly limit: number;
  readonly count: number;

  constructor(key: string, limit: number, count: number) {
    super("fixed window limit exceeded");
    this.name = "FixedWindowLimitExceeded";
    this.key = key;
    this.limit = limit;
    this.count = count;
  }
}

async function incrementDatabase(
  key: string,
  windowMs: number,
  nowMs: number,
  client: CounterClient = prisma as unknown as CounterClient,
): Promise<number> {
  const count = await upsertDatabaseCounter(key, windowMs, nowMs, client);
  sweepExpiredDatabaseCounters(client);
  return count;
}

async function upsertDatabaseCounter(
  key: string,
  windowMs: number,
  nowMs: number,
  client: CounterClient,
): Promise<number> {
  const windowStartMs = epochWindowStart(nowMs, windowMs);
  const windowStart = new Date(windowStartMs);
  const expiresAt = new Date(windowStartMs + windowMs * 2);
  try {
    const row = await client.rateLimitCounter.upsert({
      where: { bucketKey_windowStart: { bucketKey: key, windowStart } },
      create: { bucketKey: key, windowStart, count: 1, expiresAt },
      update: { count: { increment: 1 } },
      select: { count: true },
    });
    return row.count;
  } catch (err) {
    tripDatabaseCircuit(err);
    throw err;
  }
}

async function consumeDatabaseBatch(
  reservations: ConsumeFixedWindowBatchReservation[],
  windowMs: number,
  nowMs: number,
  client: CounterClient = prisma as unknown as CounterClient,
): Promise<ConsumeFixedWindowBatchResult> {
  const run = async (tx: CounterClient): Promise<Map<string, number>> => {
    const counts = new Map<string, number>();
    for (const reservation of reservations) {
      const count = await upsertDatabaseCounter(reservation.key, windowMs, nowMs, tx);
      counts.set(reservation.key, count);
      if (count > reservation.limit) {
        throw new FixedWindowLimitExceeded(
          reservation.key,
          reservation.limit,
          count,
        );
      }
    }
    return counts;
  };

  try {
    const counts = client.$transaction ? await client.$transaction(run) : await run(client);
    sweepExpiredDatabaseCounters(client);
    return { allowed: true, counts };
  } catch (err) {
    if (err instanceof FixedWindowLimitExceeded) {
      return {
        allowed: false,
        blocked: { key: err.key, limit: err.limit, count: err.count },
        counts: new Map([[err.key, err.count]]),
      };
    }
    tripDatabaseCircuit(err);
    throw err;
  }
}

function consumeMemoryBatch(
  reservations: ConsumeFixedWindowBatchReservation[],
  windowMs: number,
  nowMs: number,
  anchor: FallbackWindowAnchor,
): ConsumeFixedWindowBatchResult {
  if (Math.random() < EXPIRED_COUNTER_SWEEP_PROBABILITY) {
    purgeStaleMemory(nowMs, windowMs);
  }

  const counts = new Map<string, number>();
  for (const reservation of reservations) {
    const count = nextMemoryCount(reservation.key, windowMs, nowMs, anchor);
    counts.set(reservation.key, count);
    if (count > reservation.limit) {
      return {
        allowed: false,
        blocked: { key: reservation.key, limit: reservation.limit, count },
        counts,
      };
    }
  }

  for (const reservation of reservations) {
    counts.set(
      reservation.key,
      incrementMemory(reservation.key, windowMs, nowMs, anchor),
    );
  }
  return { allowed: true, counts };
}

/**
 * Atomically consumes one count from the shared fixed window when available,
 * otherwise from the selected process-memory fallback window.
 */
export async function consumeFixedWindow(
  input: ConsumeFixedWindowInput,
): Promise<number> {
  const nowMs = input.nowMs ?? Date.now();
  if (databaseEnabled(nowMs)) {
    try {
      return await incrementDatabase(input.key, input.windowMs, nowMs);
    } catch {
      // The database adapter opened the circuit; consume exactly once in memory.
    }
  }
  return incrementMemory(
    input.key,
    input.windowMs,
    nowMs,
    input.fallbackWindowAnchor,
  );
}

/**
 * Reserves one count across multiple fixed-window counters all-or-nothing.
 * Database-backed reservations run inside one transaction so an over-limit
 * dimension rolls back earlier increments. Memory fallback preflights every
 * dimension before mutating any bucket.
 */
export async function consumeFixedWindowBatch(
  input: ConsumeFixedWindowBatchInput,
): Promise<ConsumeFixedWindowBatchResult> {
  const nowMs = input.nowMs ?? Date.now();
  if (input.reservations.length === 0) {
    return { allowed: true, counts: new Map() };
  }

  if (databaseEnabled(nowMs)) {
    try {
      return await consumeDatabaseBatch(input.reservations, input.windowMs, nowMs);
    } catch {
      // The database adapter opened the circuit; reserve exactly once in memory.
    }
  }
  return consumeMemoryBatch(
    input.reservations,
    input.windowMs,
    nowMs,
    input.fallbackWindowAnchor,
  );
}

/**
 * Synchronously observes a first-hit local window and mirrors an epoch-aligned
 * increment to the database best-effort. The local count drives immediate
 * process-local decisions.
 */
export function observeFixedWindow(input: ObserveFixedWindowInput): number {
  const nowMs = input.nowMs ?? Date.now();
  const count = incrementMemory(input.key, input.windowMs, nowMs, "first-hit");

  if (databaseEnabled(nowMs) && nowMs >= mirrorDisabledUntil) {
    void incrementDatabase(input.key, input.windowMs, nowMs).catch(() => {
      mirrorDisabledUntil = Date.now() + FAILURE_COOLDOWN_MS;
    });
  }

  return count;
}

/** Start timestamp of the epoch-aligned window used for usage reporting. */
export function fixedWindowStart(nowMs: number, windowMs: number): number {
  return epochWindowStart(nowMs, windowMs);
}

/** Clears adapter state. Intended for deterministic tests. */
export function resetFixedWindowCounters(): void {
  memoryBuckets.clear();
  databaseDisabledUntil = 0;
  mirrorDisabledUntil = 0;
}
