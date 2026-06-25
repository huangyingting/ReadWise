/**
 * Backward-compatibility shim (REF-025).
 * The backfill/rebuild logic now lives in src/lib/processing/.
 * All exports are re-exported unchanged so existing importers need no changes.
 */
export {
  BACKFILL_FEATURES,
  type BackfillFeature,
  type BackfillMode,
  DEFAULT_BACKFILL_BATCH_CAP,
  MAX_BACKFILL_BATCH_CAP,
  MAX_BACKFILL_SCAN,
  isBackfillFeature,
  type BackfillFilter,
  type BackfillOptions,
  type BackfillPlanItem,
  type BackfillResult,
  type CandidateArticle,
  type BackfillDeps,
  BackfillError,
  runBackfill,
} from "@/lib/processing/backfill";
