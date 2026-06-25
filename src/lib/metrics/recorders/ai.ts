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

export function recordAiCall(input: {
  feature: string;
  outcome: "success" | "error" | "empty" | "unconfigured" | "aborted";
  status?: number | string;
  durationMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}): void {
  const feature = normalizeLabelValue(input.feature);
  const outcome = normalizeOutcome(input.outcome, ["success", "error", "empty", "unconfigured", "aborted"]);
  const status_class =
    input.status === undefined
      ? outcome === "unconfigured"
        ? "unconfigured"
        : "network"
      : statusClass(input.status);
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
  const tokenEntries = [
    ["prompt", input.promptTokens],
    ["completion", input.completionTokens],
    ["total", input.totalTokens],
  ] as const;
  for (const [type, value] of tokenEntries) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      incCounter("readwise_ai_tokens_total", "AI token usage totals.", { feature, type }, value);
    }
  }
}

export function recordAiRetry(input: { feature: string; reason: string }): void {
  incCounter("readwise_ai_retries_total", "AI provider retries by feature and reason.", {
    feature: input.feature,
    reason: input.reason,
  });
}
