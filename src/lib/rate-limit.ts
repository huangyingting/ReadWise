/**
 * In-memory fixed-window rate limiter for AI-powered endpoints (US-011).
 *
 * Keyed by `userId:scope`. On each call within the current window the counter
 * increments; when it exceeds the limit an {@link ApiError}(429) is thrown so
 * the api-handler wrapper surfaces a clean HTTP 429 response.
 *
 * Configuration (env):
 *   RATE_LIMIT_AI_REQUESTS  — max requests per user per window  (default 20)
 *   RATE_LIMIT_WINDOW_MS    — window length in milliseconds      (default 60000)
 *
 * NOTE: this is per-process. In a multi-instance production deployment a shared
 * store (e.g. Redis) would be required for cross-instance enforcement.
 */
import { ApiError } from "@/lib/api-handler";

const DEFAULT_LIMIT = 20;
const DEFAULT_WINDOW_MS = 60_000;

function getLimit(): number {
  const v = parseInt(process.env.RATE_LIMIT_AI_REQUESTS ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_LIMIT;
}

function getWindowMs(): number {
  const v = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_WINDOW_MS;
}

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

/** Purge entries whose window expired more than one window ago to prevent unbounded growth. */
function purgeStale(nowMs: number, windowMs: number): void {
  const cutoff = nowMs - windowMs * 2;
  for (const [key, bucket] of buckets) {
    if (bucket.windowStart < cutoff) buckets.delete(key);
  }
}

/**
 * Checks whether `userId` has exceeded the AI rate limit for `scope`.
 * Throws `ApiError(429)` when the limit is reached; otherwise returns void.
 *
 * @param userId - the authenticated user's id
 * @param scope  - a short string identifying the rate-limit bucket (e.g. "ai")
 */
export function checkRateLimit(userId: string, scope: string): void {
  const nowMs = Date.now();
  const windowMs = getWindowMs();
  const limit = getLimit();
  const key = `${userId}:${scope}`;

  // Occasionally purge stale entries (1-in-20 chance to keep it cheap).
  if (Math.random() < 0.05) purgeStale(nowMs, windowMs);

  const bucket = buckets.get(key);
  if (!bucket || nowMs - bucket.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: nowMs });
    return;
  }

  if (bucket.count >= limit) {
    throw new ApiError(
      429,
      `Too many AI requests. Limit is ${limit} per ${Math.round(windowMs / 1000)}s window. Please try again later.`,
    );
  }

  bucket.count += 1;
}
