/**
 * Database query metrics recorder.
 *
 * Labels are deliberately limited to provider/model/operation/outcome. SQL text,
 * bind parameters, article text, prompts, selected text, user ids, and raw ids
 * must never be logged or emitted as metric labels.
 */

import {
  DB_QUERY_DURATION_BUCKETS_MS,
  incCounter,
  normalizeLabelValue,
  normalizeOutcome,
  observeHistogram,
} from "@/lib/metrics/registry";

const DB_QUERY_OUTCOMES = ["success", "error"] as const;
const DB_PROVIDERS = ["sqlite", "postgresql", "unknown"] as const;

const DB_QUERIES_TOTAL = {
  name: "readwise_db_queries_total",
  help: "Total Prisma database operations by provider, model, operation, and outcome.",
} as const;

const DB_QUERY_DURATION_MS = {
  name: "readwise_db_query_duration_ms",
  help: "Prisma database operation duration in milliseconds.",
} as const;

const DB_SLOW_QUERIES_TOTAL = {
  name: "readwise_db_slow_queries_total",
  help: "Prisma database operations whose duration met or exceeded the configured slow-query threshold.",
} as const;

export type DbQueryOutcome = (typeof DB_QUERY_OUTCOMES)[number];

export type DbQueryMetricInput = {
  provider: string | null | undefined;
  model?: string | null;
  operation: string;
  outcome: DbQueryOutcome;
  durationMs: number;
  slow: boolean;
};

export function normalizeDbProvider(provider: string | null | undefined): string {
  return normalizeOutcome(normalizeLabelValue(provider, "unknown"), DB_PROVIDERS);
}

export function normalizeDbModel(model: string | null | undefined): string {
  return normalizeLabelValue(model ?? "client", "client");
}

export function normalizeDbOperation(operation: string | null | undefined): string {
  return normalizeLabelValue(operation ?? "unknown", "unknown");
}

function labels(input: DbQueryMetricInput) {
  return {
    provider: normalizeDbProvider(input.provider),
    model: normalizeDbModel(input.model),
    operation: normalizeDbOperation(input.operation),
    outcome: normalizeOutcome(input.outcome, DB_QUERY_OUTCOMES),
  };
}

export function recordDbQuery(input: DbQueryMetricInput): void {
  const metricLabels = labels(input);
  incCounter(DB_QUERIES_TOTAL.name, DB_QUERIES_TOTAL.help, metricLabels);
  observeHistogram(
    DB_QUERY_DURATION_MS.name,
    DB_QUERY_DURATION_MS.help,
    DB_QUERY_DURATION_BUCKETS_MS,
    metricLabels,
    input.durationMs,
  );

  if (input.slow) {
    incCounter(DB_SLOW_QUERIES_TOTAL.name, DB_SLOW_QUERIES_TOTAL.help, metricLabels);
  }
}
