/**
 * AI provider error classification (REF-067).
 *
 * Part of the AI safety/output package (`@/lib/ai/output`). Canonical home for
 * provider-error classification helpers. Backward-compatible re-exports are
 * provided by `@/lib/ai/provider`.
 *
 * Every vendor-specific failure (HTTP status, SDK error, network error) is
 * mapped onto a small, typed {@link AiErrorKind} enum so the orchestration
 * layer can make uniform retry/fallback decisions without provider knowledge.
 *
 * Design rules:
 *   - Low-cardinality: the enum has just enough variants for retry/fallback
 *     decisions; it is not an exhaustive HTTP-status catalogue.
 *   - Content-free: no prompt or response content ever enters these helpers;
 *     errors carry only metadata (status code, error name).
 *   - Pure functions: no side effects, no I/O, no logging.
 */

/**
 * Normalized provider error categories. Every vendor-specific failure (HTTP
 * status, SDK error, network error) is mapped onto exactly one of these so the
 * orchestration layer can decide retry/fallback without provider knowledge.
 */
export type AiErrorKind =
  | "unconfigured" // provider has no credentials
  | "rate_limit" // 429 / throttled — retryable
  | "timeout" // request exceeded the deadline — retryable
  | "server" // 5xx — retryable
  | "auth" // 401/403 — not retryable
  | "content_filter" // provider refused on safety grounds — not retryable
  | "bad_request" // 4xx other than auth/rate-limit — not retryable
  | "network" // connection error — retryable
  | "aborted" // the caller aborted — not retryable
  | "empty" // 2xx but no usable content — not retryable
  | "unknown";

/** Maps an HTTP status to a normalized, retryable-aware error kind. */
export function classifyHttpStatus(status: number): {
  kind: AiErrorKind;
  retryable: boolean;
} {
  if (status === 429) return { kind: "rate_limit", retryable: true };
  if (status === 401 || status === 403) return { kind: "auth", retryable: false };
  if (status >= 500) return { kind: "server", retryable: true };
  if (status >= 400) return { kind: "bad_request", retryable: false };
  return { kind: "unknown", retryable: false };
}

/**
 * Maps a thrown transport error (fetch / AbortSignal) to a normalized error
 * kind. A `TimeoutError` (per-attempt deadline) is retryable; an `AbortError`
 * is reported as `aborted` and the orchestration layer decides whether it was a
 * caller-initiated abort (not retryable) using the caller's own signal.
 */
export function classifyThrownError(err: unknown): {
  kind: AiErrorKind;
  retryable: boolean;
  message: string;
} {
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError") {
    return { kind: "timeout", retryable: true, message: "timeout" };
  }
  if (name === "AbortError") {
    return { kind: "aborted", retryable: false, message: "aborted" };
  }
  return { kind: "network", retryable: true, message: "network error" };
}

/** Parses a `Retry-After` header (seconds) into a clamped delay in ms. */
export function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = parseInt(header, 10);
  if (!Number.isFinite(seconds)) return undefined;
  return Math.min(Math.max(0, seconds) * 1000, 60_000);
}
