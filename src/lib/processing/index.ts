/**
 * Public API for the content-processing subsystem (REF-025).
 *
 * Subsystem layout:
 *   processing/registry.ts   — canonical feature/step registry (FEATURE_KEYS,
 *                               FEATURE_REGISTRY, FeatureKey, FeatureDefinition)
 *   processing/state.ts      — durable per-step processing state (beginStep,
 *                               finishStep, PROCESSING_STEPS)
 *   processing/processor.ts  — article enrichment orchestration (processArticle)
 *   processing/backfill.ts   — rebuild/backfill planning (runBackfill)
 *   processing/admin-ops.ts  — content-ops read model (getContentOpsOverview)
 *
 * External importers may use this barrel or the individual sub-modules directly.
 * The old module paths (src/lib/processor.ts, src/lib/processing-state.ts,
 * src/lib/backfill.ts) are backward-compatible shims that re-export from here.
 */
export * from "./registry";
export * from "./state";
export * from "./processor";
export * from "./backfill";
export * from "./admin-ops";
