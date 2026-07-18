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

function sweepExpiredDatabaseCounters(client: CounterClient): void {
  if (Math.random() >= EXPIRED_COUNTER_SWEEP_PROBABILITY) return;
  void client.rateLimitCounter
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch(() => {});
}

function tripDatabaseCircuit(err: unknown): void {
  databaseDisabledUntil = Date.now() + FAILURE_COOLDOWN_MS;
  log.warn("fixed_window_counter.database_unavailable", {
    error: err instanceof Error ? err.message : String(err),
    cooldownMs: FAILURE_COOLDOWN_MS,
  });
}

async function incrementDatabase(
  key: string,
  windowMs: number,
  nowMs: number,
  client: CounterClient = prisma as unknown as CounterClient,
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
    sweepExpiredDatabaseCounters(client);
    return row.count;
  } catch (err) {
    tripDatabaseCircuit(err);
    throw err;
  }
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