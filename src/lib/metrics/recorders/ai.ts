/**
 * AI provider call metrics recorders.
 *
 * Records per-feature call counts, latency, token usage, and retry counts.
 * Prompts, generated text, and model identifiers are NOT labels — only the
 * bounded `feature` code and coarse `outcome`/`status_class` values are used.
 */

import {
  incCounter,
  observeHistogram,
  normalizeLabelValue,
  normalizeOutcome,
  statusClass,
  AI_DURATION_BUCKETS_MS,
} from "@/lib/metrics/registry";

type AiCallOutcome = "success" | "error" | "empty" | "unconfigured" | "aborted";

type AiCallInput = {
  feature: string;
  outcome: AiCallOutcome;
  status?: number | string;
  durationMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

const AI_CALL_OUTCOMES: readonly AiCallOutcome[] = [
  "success",
  "error",
  "empty",
  "unconfigured",
  "aborted",
];

const AI_TOKEN_FIELDS = [
  ["prompt", "promptTokens"],
  ["completion", "completionTokens"],
  ["total", "totalTokens"],
] as const;

function aiStatusClass(input: { outcome: string; status?: number | string }): string {
  if (input.status !== undefined) return statusClass(input.status);
  return input.outcome === "unconfigured" ? "unconfigured" : "network";
}

function recordAiTokenCounters(input: AiCallInput, feature: string): void {
  for (const [type, key] of AI_TOKEN_FIELDS) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      incCounter("readwise_ai_tokens_total", "AI token usage totals.", { feature, type }, value);
    }
  }
}

export function recordAiCall(input: AiCallInput): void {
  const feature = normalizeLabelValue(input.feature);
  const outcome = normalizeOutcome(input.outcome, AI_CALL_OUTCOMES);
  const status_class = aiStatusClass({ ...input, outcome });
  incCounter("readwise_ai_calls_total", "AI provider calls by feature and outcome.", {
    feature,
    outcome,
    status_class,
  });
  if (input.durationMs !== undefined) {
    observeHistogram(
      "readwise_ai_call_duration_ms",
      "AI provider call duration in milliseconds.",
      AI_DURATION_BUCKETS_MS,
      { feature, outcome },
      input.durationMs,
    );
  }
  recordAiTokenCounters(input, feature);
}

export function recordAiRetry(input: { feature: string; reason: string }): void {
  incCounter("readwise_ai_retries_total", "AI provider retries by feature and reason.", {
    feature: input.feature,
    reason: input.reason,
  });
}
