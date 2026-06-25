/** Shared retry/backoff helpers. */

export type JitteredBackoffOptions = {
  /** 1-based retry attempt number. */
  attempt: number;
  /** Base delay in milliseconds. */
  baseMs: number;
  /** Maximum delay in milliseconds. */
  maxMs: number;
  /** Injectable random source for deterministic tests. Defaults to Math.random. */
  random?: () => number;
};

/**
 * Exponential backoff with bounded jitter, capped at `maxMs`.
 *
 * This preserves the worker/job semantics used before extraction:
 * `base * 2 ** (attempt - 1)`, plus jitter capped by `min(base, exp)`, then
 * clamped to `maxMs`. A non-positive base disables waiting.
 */
export function jitteredExponentialBackoff({
  attempt,
  baseMs,
  maxMs,
  random = Math.random,
}: JitteredBackoffOptions): number {
  if (baseMs <= 0 || maxMs <= 0) return 0;
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(random() * Math.min(baseMs, exp));
  return Math.min(maxMs, exp + jitter);
}