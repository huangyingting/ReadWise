/**
 * Content processing and ingestion metrics recorders.
 *
 * Covers article processing pipeline runs and steps, and provider ingestion
 * runs. Per-article or per-run identifiers are NOT labels.
 */

import { incCounter } from "@/lib/metrics/registry";

export function recordContentProcessingRun(input: {
  outcome: "success" | "failed" | "missing";
  published?: boolean;
}): void {
  incCounter("readwise_content_processing_runs_total", "Article processing runs by outcome.", {
    outcome: input.outcome,
    published: input.published ? "true" : "false",
  });
}

export function recordContentProcessingStep(input: { step: string; status: string }): void {
  incCounter("readwise_content_processing_steps_total", "Article processing steps by status.", {
    step: input.step,
    status: input.status,
  });
}

/**
 * Records the outcome of a provider crawl/ingestion run (RW-050). Labels are
 * low-cardinality: the `provider` key (bounded code registry) and a coarse
 * `outcome` (success/empty/failed) plus the resulting `health` status. Per-run
 * counts (discovered/scraped/…) live on the ContentSource row, not as labels.
 */
export function recordIngestionRun(input: {
  provider: string;
  outcome: "success" | "empty" | "failed";
  health?: string;
}): void {
  incCounter("readwise_ingestion_runs_total", "Provider ingestion runs by outcome.", {
    provider: input.provider,
    outcome: input.outcome,
    health: input.health ?? "unknown",
  });
}
