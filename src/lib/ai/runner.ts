/**
 * AI request runner — retry/timeout orchestration (REF-026).
 *
 * Owns the retry loop, per-attempt timeout signal construction, and exponential
 * backoff + jitter. Accepts a pluggable {@link AiProvider} and normalized
 * request options; returns a discriminated-union result that covers every
 * terminal outcome. Cross-cutting concerns (budget checks, ledger writes,
 * metrics, tracing) stay in the caller ({@link "@/lib/ai"} facade) so the
 * runner is independently testable and reusable.
 *
 * Provider abstraction is respected: the runner depends only on
 * {@link AiProvider} from `@/lib/ai/provider`, never on a concrete
 * implementation such as AzureOpenAiProvider.
 */
import type { AiErrorKind } from "@/lib/ai/output/error-classifier";
import type { AiProvider, AiUsage, AiChatMessage } from "@/lib/ai/provider";

// ---------------------------------------------------------------------------
// Runner options and callback
// ---------------------------------------------------------------------------

export type AiRunnerOptions = {
  maxOutputTokens?: number;
  /** External caller AbortSignal (e.g. a route-handler timeout). */
  externalSignal?: AbortSignal;
  /** Maximum number of retry attempts after the first failure. */
  maxRetries: number;
  /** Per-attempt deadline in ms (applied via AbortSignal.timeout). */
  timeoutMs: number;
};

/** Passed to the optional `onRetry` callback before each retry delay. */
export type AiRetryInfo = {
  /** Zero-based index of the attempt that just failed (0 = first attempt). */
  attempt: number;
  model: string;
  reason: AiErrorKind;
  status?: number;
  delayMs: number;
};

// ---------------------------------------------------------------------------
// Discriminated union of all terminal outcomes
// ---------------------------------------------------------------------------

export type AiRunnerSuccess = {
  outcome: "success";
  text: string;
  usage: AiUsage | null;
  model: string;
  durationMs: number;
  status: number;
  finishReason: string;
};

export type AiRunnerEmpty = {
  outcome: "empty" | "content_filter";
  durationMs: number;
  model: string;
  usage: AiUsage | null;
  finishReason?: string;
  /** HTTP status from the provider response (typically 200 for content errors). */
  status?: number;
};

export type AiRunnerAborted = {
  outcome: "aborted";
  durationMs: number;
};

export type AiRunnerError = {
  outcome: "error";
  durationMs: number;
  errorKind: AiErrorKind;
  status?: number;
  errorMessage?: string;
  /** Total provider attempts made (including the first attempt). */
  attemptsMade: number;
};

export type AiRunnerResult = AiRunnerSuccess | AiRunnerEmpty | AiRunnerAborted | AiRunnerError;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function backoffMs(attempt: number, base = 1000, max = 10_000): number {
  const exp = Math.min(max, base * 2 ** (attempt - 1));
  return Math.min(max, exp + Math.floor(Math.random() * Math.min(base, exp)));
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Executes a chat completion with bounded retry and per-attempt timeout.
 * Calls {@link AiProvider.chat} one to `maxRetries + 1` times, honoring any
 * provider Retry-After hint on rate-limit failures.
 *
 * The provider MUST already be configured (callers check
 * {@link AiProvider.isConfigured} first). The runner never throws.
 *
 * @param onRetry - Optional callback invoked before each retry sleep.
 *   Lets callers record metrics / structured log entries per retry without
 *   coupling the runner to an observability library.
 */
export async function runAiRequest(
  provider: AiProvider,
  messages: AiChatMessage[],
  opts: AiRunnerOptions,
  onRetry?: (info: AiRetryInfo) => void,
): Promise<AiRunnerResult> {
  const { maxRetries, timeoutMs, maxOutputTokens, externalSignal } = opts;
  const modelName = provider.modelName() ?? "unknown";
  let lastDurationMs = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = externalSignal
      ? AbortSignal.any([externalSignal, timeoutSignal])
      : timeoutSignal;

    const response = await provider.chat({ messages, maxOutputTokens, signal });
    lastDurationMs = response.durationMs;

    if (response.ok) {
      return {
        outcome: "success",
        text: response.text,
        usage: response.usage,
        model: response.model,
        durationMs: response.durationMs,
        status: response.status,
        finishReason: response.finishReason,
      };
    }

    const error = response.error;

    // 2xx with no usable content (empty body or content-filter refusal).
    // Not retryable — degrade gracefully rather than retrying.
    if (error.kind === "empty" || error.kind === "content_filter") {
      return {
        outcome: error.kind,
        durationMs: response.durationMs,
        model: modelName,
        usage: error.usage ?? null,
        finishReason: error.finishReason,
        status: error.status,
      };
    }

    // Caller-initiated abort: stop immediately without retrying.
    if (error.kind === "aborted" && externalSignal?.aborted) {
      return { outcome: "aborted", durationMs: response.durationMs };
    }

    // Retryable failure (rate-limit / 5xx / timeout / network) with attempts
    // remaining: notify caller, honor any provider Retry-After hint, then loop.
    if (error.retryable && attempt < maxRetries) {
      const delayMs = error.retryAfterMs ?? backoffMs(attempt + 1);
      onRetry?.({ attempt, model: modelName, reason: error.kind, status: error.status, delayMs });
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    // Terminal failure: retries exhausted or non-retryable error.
    return {
      outcome: "error",
      durationMs: response.durationMs,
      errorKind: error.kind,
      status: error.status,
      errorMessage: error.status ? `HTTP ${error.status}` : error.message,
      attemptsMade: attempt + 1,
    };
  }

  // Unreachable under normal control flow; guard for TypeScript exhaustiveness.
  return {
    outcome: "error",
    durationMs: lastDurationMs,
    errorKind: "unknown",
    errorMessage: "exhausted retries",
    attemptsMade: maxRetries + 1,
  };
}
