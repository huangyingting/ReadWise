/**
 * Fixed-window rate limiter for AI-powered, lookup, public, import, admin-job
 * and auth-sensitive endpoints.
 *
 * Backed by a SHARED (DB-backed) store (RW-026) so limits are enforced
 * consistently across app instances. The in-memory limiter remains a graceful
 * FALLBACK for dev/tests and whenever the shared store is unavailable — see
 * {@link "@/lib/security/rate-limit/store"}.
 *
 * Keyed by an arbitrary string `key` + `scope`. On each call within the current
 * window the counter increments; when it exceeds the limit an {@link ApiError}
 * (429) is thrown so the api-handler wrapper surfaces a clean HTTP 429 response.
 * For unauthenticated endpoints the key is derived from the client IP.
 *
 * NOTE: `checkRateLimit`/`checkRateLimitByKey` are ASYNC (the shared store is a
 * DB round-trip). All call sites `await` them. `clientIpKey` stays synchronous.
 *
 * Configuration (env):
 *   RATE_LIMIT_AI_REQUESTS         — "ai" scope          (default 20)
 *   RATE_LIMIT_LOOKUP_REQUESTS     — "lookup" scope      (default 60)
 *   RATE_LIMIT_PUBLIC_REQUESTS     — "public" scope      (default 30)
 *   RATE_LIMIT_IMPORT_REQUESTS     — "import" scope      (default 10)
 *   RATE_LIMIT_ADMIN_JOB_REQUESTS  — "admin-job" scope   (default 30)
 *   RATE_LIMIT_AUTH_REQUESTS       — "auth" scope        (default 10)
 *   RATE_LIMIT_WINDOW_MS           — window length (ms)  (default 60000)
 *   RATE_LIMIT_STORE               — auto | database | memory
 */
import { ApiError } from "@/lib/errors/api-error";
import { createLogger } from "@/lib/observability/logger";
import { clientIpKey } from "@/lib/security/client-ip";
import {
  rateLimitAdminJobRequests,
  rateLimitAiRequests,
  rateLimitAuthRequests,
  rateLimitImportRequests,
  rateLimitLookupRequests,
  rateLimitPublicRequests,
  rateLimitWindowMs,
} from "@/lib/runtime-config/rate-limit";
import {
  incrementSharedCounter,
  isSharedStoreEnabled,
  windowStartFor,
} from "@/lib/security/rate-limit/store";

const log = createLogger("rate-limit");

const LIMIT_RESOLVERS = {
  lookup: rateLimitLookupRequests,
  public: rateLimitPublicRequests,
  import: rateLimitImportRequests,
  "admin-job": rateLimitAdminJobRequests,
  auth: rateLimitAuthRequests,
  ai: rateLimitAiRequests,
} as const;

export type RateLimitScope = keyof typeof LIMIT_RESOLVERS;

function getLimitForScope(scope: RateLimitScope): number {
  return LIMIT_RESOLVERS[scope]();
}

function getWindowMs(): number {
  return rateLimitWindowMs();
}

function rateLimitError(limit: number, windowMs: number): ApiError {
  return new ApiError(
    429,
    `Too many requests. Limit is ${limit} per ${Math.round(windowMs / 1000)}s window. Please try again later.`,
  );
}

// --- in-memory fallback ----------------------------------------------------

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

/** Purge entries whose window expired more than one window ago. */
function purgeStale(nowMs: number, windowMs: number): void {
  const cutoff = nowMs - windowMs * 2;
  for (const [key, bucket] of buckets) {
    if (bucket.windowStart < cutoff) buckets.delete(key);
  }
}

/** Process-local fixed-window check (fallback when the shared store is down). */
function checkInMemory(bucketKey: string, limit: number, windowMs: number, nowMs: number): void {
  if (Math.random() < 0.05) purgeStale(nowMs, windowMs);

  const bucket = buckets.get(bucketKey);
  if (!bucket || nowMs - bucket.windowStart >= windowMs) {
    buckets.set(bucketKey, { count: 1, windowStart: nowMs });
    return;
  }

  if (bucket.count >= limit) {
    throw rateLimitError(limit, windowMs);
  }

  bucket.count += 1;
}

async function checkSharedStore(
  bucketKey: string,
  scope: RateLimitScope,
  limit: number,
  windowMs: number,
  nowMs: number,
): Promise<boolean> {
  if (!isSharedStoreEnabled(nowMs)) return false;

  try {
    const windowStartMs = windowStartFor(nowMs, windowMs);
    const count = await incrementSharedCounter(bucketKey, windowStartMs, windowMs);
    if (count > limit) {
      throw rateLimitError(limit, windowMs);
    }
    return true;
  } catch (err) {
    // A genuine 429 must propagate; only a store failure falls back to memory.
    if (err instanceof ApiError) throw err;
    log.warn("rate_limit.fallback_memory", { scope });
    return false;
  }
}

/**
 * Core rate-limit check by an arbitrary key (userId, hashed IP, etc.) and scope.
 * Tries the shared DB store first, then falls back to the in-memory limiter when
 * that store is unavailable. Throws `ApiError(429)` when the limit is reached.
 */
export async function checkRateLimitByKey(
  key: string,
  scope: RateLimitScope,
): Promise<void> {
  const windowMs = getWindowMs();
  const limit = getLimitForScope(scope);
  const bucketKey = `${key}:${scope}`;
  const nowMs = Date.now();

  if (await checkSharedStore(bucketKey, scope, limit, windowMs, nowMs)) {
    return;
  }

  checkInMemory(bucketKey, limit, windowMs, nowMs);
}

/**
 * Checks whether `userId` has exceeded the rate limit for `scope`.
 * Throws `ApiError(429)` when the limit is reached; otherwise resolves.
 *
 * @param userId - the authenticated user's id
 * @param scope  - a short string identifying the bucket (ai|lookup|public|import|admin-job|auth)
 */
export async function checkRateLimit(
  userId: string,
  scope: RateLimitScope,
): Promise<void> {
  await checkRateLimitByKey(userId, scope);
}

export type SessionRateLimitContext = {
  session: { user: { id: string } };
};

export type ClientIpRateLimitContext = {
  req: Request;
};

export type RateLimitPolicy<Context, OnExceededResult = void> = {
  scope: RateLimitScope;
  resolveKey: (context: Context) => string;
  onExceeded?: (
    context: Context,
    error: ApiError,
  ) => OnExceededResult | Promise<OnExceededResult>;
};

export function defineRateLimitPolicy<Context, OnExceededResult = void>(
  policy: RateLimitPolicy<Context, OnExceededResult>,
): RateLimitPolicy<Context, OnExceededResult> {
  return policy;
}

export function sessionUserRateLimitPolicy<OnExceededResult = void>(
  scope: RateLimitScope,
  options?: {
    onExceeded?: RateLimitPolicy<
      SessionRateLimitContext,
      OnExceededResult
    >["onExceeded"];
  },
): RateLimitPolicy<SessionRateLimitContext, OnExceededResult> {
  return defineRateLimitPolicy({
    scope,
    resolveKey: ({ session }) => session.user.id,
    ...(options?.onExceeded ? { onExceeded: options.onExceeded } : {}),
  });
}

export function clientIpRateLimitPolicy<OnExceededResult = void>(
  scope: RateLimitScope,
  options?: {
    onExceeded?: RateLimitPolicy<
      ClientIpRateLimitContext,
      OnExceededResult
    >["onExceeded"];
  },
): RateLimitPolicy<ClientIpRateLimitContext, OnExceededResult> {
  return defineRateLimitPolicy({
    scope,
    resolveKey: ({ req }) => clientIpKey(req),
    ...(options?.onExceeded ? { onExceeded: options.onExceeded } : {}),
  });
}

/**
 * Enforces a declarative rate-limit policy.
 *
 * - Default: throws `ApiError(429)` exactly like `checkRateLimit*`.
 * - Optional `onExceeded`: route-specific fallback response/behavior for 429 only.
 */
export async function enforceRateLimitPolicy<
  Context,
  OnExceededResult = void,
>(
  policy: RateLimitPolicy<Context, OnExceededResult>,
  context: Context,
): Promise<OnExceededResult | undefined> {
  try {
    await checkRateLimitByKey(policy.resolveKey(context), policy.scope);
    return undefined;
  } catch (error) {
    if (policy.onExceeded && error instanceof ApiError && error.status === 429) {
      return await policy.onExceeded(context, error);
    }
    throw error;
  }
}

/**
 * Extracts a client IP rate-limit key from a Request using the trusted-proxy
 * aware resolver in {@link "@/lib/security/client-ip"}. See `docs/security/overview.md`
 * for how to configure trusted proxies; with none configured this is a SOFT
 * (spoofable) per-IP identity suitable only for best-effort limits.
 */
export { clientIpKey };
