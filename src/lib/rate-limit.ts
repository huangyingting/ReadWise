/**
 * In-memory fixed-window rate limiter for AI-powered and public endpoints.
 *
 * Keyed by an arbitrary string `key` + `scope`. On each call within the
 * current window the counter increments; when it exceeds the limit an
 * {@link ApiError}(429) is thrown so the api-handler wrapper surfaces a
 * clean HTTP 429 response. For unauthenticated endpoints the key is
 * derived from the client IP (via `x-forwarded-for` or a fallback).
 *
 * Configuration (env):
 *   RATE_LIMIT_AI_REQUESTS      — max requests per key per window  (default 20)
 *   RATE_LIMIT_LOOKUP_REQUESTS  — limit for "lookup" scope         (default 60)
 *   RATE_LIMIT_PUBLIC_REQUESTS  — limit for "public" scope         (default 30)
 *   RATE_LIMIT_WINDOW_MS        — window length in milliseconds     (default 60000)
 *
 * NOTE: this is per-process. In a multi-instance production deployment a shared
 * store (e.g. Redis) would be required for cross-instance enforcement.
 */
import { ApiError } from "@/lib/api-handler";

const DEFAULT_AI_LIMIT = 20;
const DEFAULT_LOOKUP_LIMIT = 60;
const DEFAULT_PUBLIC_LIMIT = 30;
const DEFAULT_WINDOW_MS = 60_000;

function getLimitForScope(scope: string): number {
  if (scope === "lookup") {
    const v = parseInt(process.env.RATE_LIMIT_LOOKUP_REQUESTS ?? "", 10);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_LOOKUP_LIMIT;
  }
  if (scope === "public") {
    const v = parseInt(process.env.RATE_LIMIT_PUBLIC_REQUESTS ?? "", 10);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_PUBLIC_LIMIT;
  }
  const v = parseInt(process.env.RATE_LIMIT_AI_REQUESTS ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_AI_LIMIT;
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
 * Core rate-limit check by an arbitrary key (userId, hashed IP, etc.) and scope.
 * Throws `ApiError(429)` when the limit is reached; otherwise returns void.
 */
export function checkRateLimitByKey(key: string, scope: string): void {
  const nowMs = Date.now();
  const windowMs = getWindowMs();
  const limit = getLimitForScope(scope);
  const bucketKey = `${key}:${scope}`;

  // Occasionally purge stale entries (5% chance to keep it cheap).
  if (Math.random() < 0.05) purgeStale(nowMs, windowMs);

  const bucket = buckets.get(bucketKey);
  if (!bucket || nowMs - bucket.windowStart >= windowMs) {
    buckets.set(bucketKey, { count: 1, windowStart: nowMs });
    return;
  }

  if (bucket.count >= limit) {
    throw new ApiError(
      429,
      `Too many requests. Limit is ${limit} per ${Math.round(windowMs / 1000)}s window. Please try again later.`,
    );
  }

  bucket.count += 1;
}

/**
 * Checks whether `userId` has exceeded the rate limit for `scope`.
 * Throws `ApiError(429)` when the limit is reached; otherwise returns void.
 *
 * @param userId - the authenticated user's id
 * @param scope  - a short string identifying the rate-limit bucket (e.g. "ai", "lookup")
 */
export function checkRateLimit(userId: string, scope: string): void {
  checkRateLimitByKey(userId, scope);
}

/**
 * Extracts a best-effort client IP from a Request for use as a rate-limit key.
 * Uses `x-forwarded-for` (first hop, trusted behind a proxy) or falls back to
 * a fixed string so the limiter degrades gracefully rather than skipping.
 *
 * NOTE: x-forwarded-for can be spoofed if the server is not behind a trusted
 * reverse proxy. This is an acceptable trade-off for a soft per-IP cap.
 */
export function clientIpKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    // Take the first IP (client); subsequent entries are added by proxies.
    const first = xff.split(",")[0].trim();
    if (first) return `ip:${first}`;
  }
  return "ip:unknown";
}
