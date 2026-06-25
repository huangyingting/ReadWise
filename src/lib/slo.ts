/**
 * Re-export shim — canonical implementation lives in `@/lib/observability/slo`.
 *
 * All existing importers of `@/lib/slo` continue to work without changes.
 * See REF-053 for context.
 */
export type {
  SliCategory,
  SliKind,
  SliMeasurement,
  SliDefinition,
  SliStatus,
  SliEvaluation,
  SloReport,
} from "@/lib/observability/slo";
export { SLI_CATALOG, evaluateSlos } from "@/lib/observability/slo";
