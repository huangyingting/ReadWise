/**
 * Rate-limiting configuration (server-only).
 *
 * IMPORTANT: never import from a Client Component.
 */
import { positiveIntEnv } from "@/lib/runtime-config/env";

const DEFAULT_RATE_LIMIT_AI = 20;
const DEFAULT_RATE_LIMIT_LOOKUP = 60;
const DEFAULT_RATE_LIMIT_PUBLIC = 30;
const DEFAULT_RATE_LIMIT_IMPORT = 10;
const DEFAULT_RATE_LIMIT_ADMIN_JOB = 30;
const DEFAULT_RATE_LIMIT_AUTH = 10;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

/** Max requests per key per window for the "ai" scope (default 20). */
export function rateLimitAiRequests(): number {
  return positiveIntEnv("RATE_LIMIT_AI_REQUESTS", DEFAULT_RATE_LIMIT_AI);
}

/** Max requests per key per window for the "lookup" scope (default 60). */
export function rateLimitLookupRequests(): number {
  return positiveIntEnv("RATE_LIMIT_LOOKUP_REQUESTS", DEFAULT_RATE_LIMIT_LOOKUP);
}

/** Max requests per key per window for the "public" scope (default 30). */
export function rateLimitPublicRequests(): number {
  return positiveIntEnv("RATE_LIMIT_PUBLIC_REQUESTS", DEFAULT_RATE_LIMIT_PUBLIC);
}

/** Max requests per key per window for the "import" scope (default 10). */
export function rateLimitImportRequests(): number {
  return positiveIntEnv("RATE_LIMIT_IMPORT_REQUESTS", DEFAULT_RATE_LIMIT_IMPORT);
}

/** Max requests per key per window for the "admin-job" scope (default 30). */
export function rateLimitAdminJobRequests(): number {
  return positiveIntEnv("RATE_LIMIT_ADMIN_JOB_REQUESTS", DEFAULT_RATE_LIMIT_ADMIN_JOB);
}

/** Max requests per key per window for the "auth" scope (default 10). */
export function rateLimitAuthRequests(): number {
  return positiveIntEnv("RATE_LIMIT_AUTH_REQUESTS", DEFAULT_RATE_LIMIT_AUTH);
}

/** Rate-limit window length in ms (RATE_LIMIT_WINDOW_MS, default 60000). */
export function rateLimitWindowMs(): number {
  return positiveIntEnv("RATE_LIMIT_WINDOW_MS", DEFAULT_RATE_LIMIT_WINDOW_MS);
}

export type RateLimitStoreMode = "auto" | "database" | "memory";

/**
 * Backing store for the shared rate limiter (RATE_LIMIT_STORE, default "auto").
 *   - "auto"     — use the DB-backed shared store, falling back to in-memory on error.
 *   - "database" — always use the DB store (still falls back to memory on error).
 *   - "memory"   — never touch the DB; use the process-local limiter only.
 */
export function rateLimitStoreMode(): RateLimitStoreMode {
  const raw = (process.env.RATE_LIMIT_STORE ?? "").trim().toLowerCase();
  if (raw === "database" || raw === "memory" || raw === "auto") return raw;
  return process.env.NODE_ENV === "test" ? "memory" : "auto";
}
