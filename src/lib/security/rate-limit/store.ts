/**
 * Shared (DB-backed) rate-limit store (RW-026).
 *
 * Backs the rate limiter with a PostgreSQL/SQLite-backed counter so limits are
 * enforced consistently across app instances (the old limiter was per-process).
 * A fixed window is identified by `windowStart = floor(now / windowMs) * windowMs`;
 * an atomic upsert increments the row's `count` and returns the new value.
 *
 * Graceful degradation (consistent with the codebase's isAiConfigured-style
 * patterns): when the store is unavailable (no migration, DB down, or mocked in
 * tests) the caller falls back to the in-memory limiter. To avoid hammering a
 * missing DB on every request, a short circuit-breaker cooldown is applied after
 * a failure.
 */
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/observability/logger";
import { rateLimitStoreMode } from "@/lib/runtime-config/rate-limit";

const log = createLogger("rate-limit-store");

/** Minimal prisma surface the store needs (eases testing/composition). */
export type RateLimitStoreClient = {
  rateLimitCounter: {
    upsert: (args: unknown) => Promise<{ count: number }>;
    deleteMany: (args: unknown) => Promise<unknown>;
  };
};

/** How long to skip the DB store after a failure before retrying it. */
const FAILURE_COOLDOWN_MS = 30_000;
let disabledUntil = 0;

/** Reset the circuit breaker (test seam). */
export function resetRateLimitStore(): void {
  disabledUntil = 0;
}

/** Whether the DB-backed store should be attempted for this request. */
export function isSharedStoreEnabled(now = Date.now()): boolean {
  const mode = rateLimitStoreMode();
  if (mode === "memory") return false;
  if (mode === "auto" && now < disabledUntil) return false;
  return true;
}

/** Align a timestamp to the start of its fixed window. */
export function windowStartFor(nowMs: number, windowMs: number): number {
  return Math.floor(nowMs / windowMs) * windowMs;
}

/**
 * Atomically increment the (bucketKey, windowStart) counter and return the new
 * count. Throws on any store error so the caller can fall back to memory.
 */
export async function incrementSharedCounter(
  bucketKey: string,
  windowStartMs: number,
  windowMs: number,
  client: RateLimitStoreClient = prisma as unknown as RateLimitStoreClient,
): Promise<number> {
  const windowStart = new Date(windowStartMs);
  const expiresAt = new Date(windowStartMs + windowMs * 2);
  try {
    const row = await client.rateLimitCounter.upsert({
      where: { bucketKey_windowStart: { bucketKey, windowStart } },
      create: { bucketKey, windowStart, count: 1, expiresAt },
      update: { count: { increment: 1 } },
      select: { count: true },
    });
    // Best-effort, cheap sweep of expired rows (5% of calls).
    if (Math.random() < 0.05) {
      void client.rateLimitCounter
        .deleteMany({ where: { expiresAt: { lt: new Date() } } })
        .catch(() => {});
    }
    return row.count;
  } catch (err) {
    // Trip the circuit breaker so we don't retry a dead store every request.
    disabledUntil = Date.now() + FAILURE_COOLDOWN_MS;
    log.warn("rate_limit_store.unavailable", {
      error: err instanceof Error ? err.message : String(err),
      cooldownMs: FAILURE_COOLDOWN_MS,
    });
    throw err;
  }
}
