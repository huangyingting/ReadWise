/**
 * Internal AI provider abstraction (RW-023).
 *
 * The rest of the app talks to AI through the stable `chatComplete*` API in
 * `@/lib/ai`. That module owns the cross-cutting orchestration (retries,
 * timeouts, AI budgets/quotas, the invocation ledger, metrics, and tracing) and
 * delegates the actual transport — "given these messages, do ONE chat-completion
 * attempt against a model" — to an {@link AiProvider}.
 *
 * Keeping the provider as a single-attempt transport (no retry loop, no ledger)
 * means:
 *   - The behaviour-preserving orchestration in `ai.ts` is unchanged; only the
 *     inner fetch/parse/error-classification moves behind this interface.
 *   - Adding a second provider later (a different vendor, a local model, a mock)
 *     is a matter of implementing {@link AiProvider} — feature helpers never
 *     change because they only ever see provider-agnostic `chatComplete*`.
 *   - Provider-specific failures are normalized into a small, typed
 *     {@link AiErrorKind} enum so the orchestration can make uniform retry /
 *     fallback decisions.
 *
 * No prompt or response *content* ever leaves this layer except as the returned
 * assistant text; errors carry only low-cardinality metadata.
 */

/** A single chat message exchanged with a model. */
export type AiChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** A single chat-completion request handed to a provider. */
export type AiChatRequest = {
  messages: AiChatMessage[];
  /** Upper bound on generated tokens. Providers map this to their own field. */
  maxOutputTokens?: number;
  /**
   * Desired sampling temperature. Providers that advertise
   * `supportsTemperature: false` (e.g. Azure gpt-5-mini) MUST ignore this.
   */
  temperature?: number;
  /** Combined abort signal (caller signal + per-attempt timeout). */
  signal?: AbortSignal;
};

/** Normalized token usage as reported by the provider. */
export type AiUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

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

/** A normalized provider failure. Carries only low-cardinality metadata. */
export type AiProviderError = {
  kind: AiErrorKind;
  /** Whether the orchestration may retry this attempt. */
  retryable: boolean;
  /** Short, non-sensitive message for logs/ledger. */
  message: string;
  /** Upstream HTTP status, when the failure came from an HTTP response. */
  status?: number;
  /** Suggested delay (ms) parsed from a provider hint such as `Retry-After`. */
  retryAfterMs?: number;
  /** Token usage, when the provider returned usage alongside an empty body. */
  usage?: AiUsage | null;
  /** Provider finish reason, when available (e.g. "content_filter", "length"). */
  finishReason?: string;
};

/** A successful chat completion. */
export type AiChatSuccess = {
  ok: true;
  text: string;
  usage: AiUsage | null;
  model: string;
  finishReason: string;
  durationMs: number;
  status: number;
};

/** A failed chat completion (already normalized). */
export type AiChatFailure = {
  ok: false;
  error: AiProviderError;
  durationMs: number;
};

/** The result of a single provider chat attempt. Providers never throw. */
export type AiChatResponse = AiChatSuccess | AiChatFailure;

/**
 * Static capability metadata for a provider/model. Used by long-text chunking
 * (RW-025) to keep prompts within the model context window and by the transport
 * to shape the request body for the specific model family.
 */
export type AiProviderCapabilities = {
  /** Stable provider id, e.g. "azure-openai". */
  provider: string;
  /** Maximum context window in tokens (prompt + completion combined). */
  maxContextTokens: number;
  /** Default completion-token budget when a caller does not specify one. */
  defaultMaxOutputTokens: number;
  /** Whether a custom `temperature` is accepted (gpt-5-mini rejects it). */
  supportsTemperature: boolean;
  /** The request field used to cap output tokens for this model family. */
  tokenParamName: "max_completion_tokens" | "max_tokens";
};

/**
 * A pluggable AI transport. Implementations perform a SINGLE chat-completion
 * attempt and normalize all outcomes; they never throw, never retry, and never
 * touch the ledger/metrics/budget (those are owned by `@/lib/ai`).
 */
export interface AiProvider {
  /** Stable identifier, mirrors {@link AiProviderCapabilities.provider}. */
  readonly id: string;
  /** Whether the provider has the credentials it needs to make a call. */
  isConfigured(): boolean;
  /** The active model/deployment name, or null when unconfigured. */
  modelName(): string | null;
  /** Static capability metadata for the active model. */
  capabilities(): AiProviderCapabilities;
  /** Performs one chat-completion attempt, returning a normalized response. */
  chat(request: AiChatRequest): Promise<AiChatResponse>;
}

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
