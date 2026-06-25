/**
 * Backward-compatibility shim (REF-025).
 * The processing-state logic now lives in src/lib/processing/.
 * All exports are re-exported unchanged so existing importers need no changes.
 */
export {
  PROCESSING_STEPS,
  type ProcessingStepName,
  PROCESSING_STEP_STATUSES,
  type ProcessingStepStatus,
  translationStepKey,
  type StepRow,
  beginStep,
  type FinishStepOptions,
  finishStep,
  getArticleProcessingSteps,
  type StepResetClient,
  resetProcessingSteps,
} from "@/lib/processing/state";
