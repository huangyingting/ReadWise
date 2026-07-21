/**
 * Client-safe helpers for the admin SLO dashboard (#1187).
 */
import type { BadgeProps } from "@/components/ui/Badge";
import type {
  SliDefinition,
  SliEvaluation,
  SliStatus,
  SloReport,
} from "@/lib/observability/slo";

export type SloDashboardResponse = {
  catalog: SliDefinition[];
  report: SloReport;
};

export type SliCatalogByKey = Record<string, SliDefinition | undefined>;

export function sloStatusEndpoint(): string {
  return "/api/admin/slo";
}

export function sloStatusBadgeVariant(status: SliStatus): BadgeProps["variant"] {
  if (status === "ok") return "success";
  if (status === "breaching") return "danger";
  return "neutral";
}

export function formatSloPercent(value: number | null): string {
  if (value === null) return "No data";
  return `${(value * 100).toFixed(1)}%`;
}

export function formatSloObjective(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatLatencyThreshold(sli: SliEvaluation): string {
  return sli.latencyThresholdMs === undefined
    ? "—"
    : `${sli.latencyThresholdMs} ms`;
}

export function sliCatalogByKey(
  catalog: SliDefinition[],
): SliCatalogByKey {
  return Object.fromEntries(catalog.map((definition) => [definition.key, definition]));
}
