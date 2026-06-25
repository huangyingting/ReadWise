/**
 * Trusted-provider HTTP client (REF-073).
 *
 * Use for outbound calls to fixed, trusted provider endpoints — dictionary API,
 * Azure Speech STS token endpoint, and similar. These targets are NOT
 * user-supplied, so SSRF IP-pinning is unnecessary. For user-supplied or
 * untrusted URLs, use the SSRF-safe fetch in `src/lib/scraper/fetch.ts`.
 *
 * Features:
 *  - Hard request timeout (default {@link DEFAULT_PROVIDER_TIMEOUT_MS}).
 *  - Composes cleanly with a caller-supplied AbortSignal.
 *  - Optional exponential-backoff retries on transient status codes (429/503/504),
 *    respecting `Retry-After` headers on 429. Default is no retries.
 *  - Low-cardinality logging: only provider/host/status metadata, never credentials,
 *    user content, or full URLs with sensitive query strings.
 *
 * Network policy categories (REF-073):
 *  - `untrusted`  → scraper/SSRF-pinned fetch in src/lib/scraper/fetch.ts
 *  - `provider`   → this module (dictionary, Azure Speech token, etc.)
 *  - `azure-sdk`  → Azure SDK manages its own transport (AI, Storage)
 *  - `push`       → web-push library manages delivery
 *  - `client`     → src/lib/client-fetch.ts (browser-side)
 */

import { createLogger } from "@/lib/logger";
import { jitteredExponentialBackoff } from "@/lib/backoff";

const log = createLogger("http.provider");

/** Default timeout in ms for trusted-provider requests. */
export const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;

/** Default base backoff delay in ms for retries. */
const DEFAULT_BACKOFF_BASE_MS = 500;

/** Default max backoff delay in ms for retries. */
const DEFAULT_BACKOFF_MAX_MS = 5_000;

/** Status codes that are safe to retry. */
const RETRYABLE_STATUSES = new Set([429, 503, 504]);

export type ProviderFetchOptions = {
  /**
   * Hard request timeout in ms. Aborting the timeout aborts the underlying
   * fetch. Defaults to {@link DEFAULT_PROVIDER_TIMEOUT_MS}.
   * Pass `0` to disable the timeout entirely.
   */
  timeoutMs?: number;
  /**
   * Number of additional attempts after an initial transient failure (429/503/504).
   * Defaults to 0 (no retries).
   */
  retries?: number;
  /** Base delay in ms for exponential backoff. Defaults to 500. */
  backoffBaseMs?: number;
  /** Max delay in ms for exponential backoff. Defaults to 5_000. */
  backoffMaxMs?: number;
  /**
   * Low-cardinality provider name for log context (e.g. "dictionary",
   * "speech-token"). Never use a value that includes user content or credentials.
   */
  provider?: string;
};

/**
 * Parses a `Retry-After` header value (seconds or HTTP-date) into ms.
 * Returns null when the header is absent or unparseable.
 */
function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = parseFloat(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

/**
 * Builds an AbortSignal that fires after `timeoutMs` ms, optionally composed
 * with a caller-supplied signal so either one can cancel the request.
 * Returns `{ signal, cleanup }` — always call `cleanup()` in a finally block.
 */
function buildSignal(
  timeoutMs: number,
  callerSignal?: AbortSignal | null,
): { signal: AbortSignal; cleanup: () => void } {
  if (timeoutMs <= 0 && !callerSignal) {
    return { signal: new AbortController().signal, cleanup: () => {} };
  }

  const signals: AbortSignal[] = [];

  let timerId: ReturnType<typeof setTimeout> | undefined;
  let timeoutController: AbortController | undefined;
  if (timeoutMs > 0) {
    timeoutController = new AbortController();
    timerId = setTimeout(() => timeoutController!.abort(), timeoutMs);
    signals.push(timeoutController.signal);
  }

  if (callerSignal) {
    signals.push(callerSignal);
  }

  const signal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);

  return {
    signal,
    cleanup: () => {
      if (timerId !== undefined) clearTimeout(timerId);
    },
  };
}

/**
 * Fetches a trusted-provider URL with a configurable timeout and optional
 * retries. Throws a `TypeError` on network/timeout failure (same as native
 * `fetch`). Non-OK HTTP responses are returned as-is so callers can inspect
 * `response.ok` and `response.status` themselves.
 *
 * ```ts
 * const res = await providerFetch(url, { method: "POST", headers: {...} }, {
 *   timeoutMs: 8_000,
 *   provider: "dictionary",
 * });
 * if (!res.ok) { ... }
 * ```
 */
export async function providerFetch(
  url: string,
  init?: RequestInit,
  opts?: ProviderFetchOptions,
): Promise<Response> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  const maxRetries = opts?.retries ?? 0;
  const backoffBase = opts?.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
  const backoffMax = opts?.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS;
  const provider = opts?.provider ?? "unknown";

  // Extract host for low-cardinality logging — never include path or query.
  let host = "unknown";
  try {
    host = new URL(url).hostname;
  } catch {
    // keep "unknown" if URL is malformed
  }

  let attempt = 0;

  for (;;) {
    const { signal, cleanup } = buildSignal(timeoutMs, init?.signal as AbortSignal | null);
    const start = Date.now();

    let res: Response;
    try {
      res = await fetch(url, { ...init, signal });
    } catch (err) {
      cleanup();
      const durationMs = Date.now() - start;
      log.warn("http.provider.fetch_error", {
        provider,
        host,
        attempt,
        durationMs,
        error: String(err),
      });
      throw err;
    }
    cleanup();

    const durationMs = Date.now() - start;
    const status = res.status;

    if (res.ok || !RETRYABLE_STATUSES.has(status) || attempt >= maxRetries) {
      if (!res.ok) {
        log.warn("http.provider.non_ok", { provider, host, status, attempt, durationMs });
      } else {
        log.info("http.provider.ok", { provider, host, status, attempt, durationMs });
      }
      return res;
    }

    // Transient failure — compute delay and retry.
    const retryAfterMs =
      status === 429 ? parseRetryAfterMs(res.headers.get("Retry-After")) : null;
    const backoffMs = jitteredExponentialBackoff({
      attempt: attempt + 1,
      baseMs: backoffBase,
      maxMs: backoffMax,
    });
    const delayMs = retryAfterMs !== null ? Math.max(retryAfterMs, backoffMs) : backoffMs;

    log.warn("http.provider.retry", {
      provider,
      host,
      status,
      attempt,
      delayMs,
      durationMs,
    });

    // Drain the body so the connection can be reused.
    await res.body?.cancel().catch(() => {});
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    attempt++;
  }
}
