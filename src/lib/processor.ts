/**
 * Backward-compatibility shim (REF-025).
 * The article-processing logic now lives in src/lib/processing/.
 * All exports are re-exported unchanged so existing importers need no changes.
 */
export {
  type StepName,
  type StepStatus,
  type StepResult,
  type ArticleProcessResult,
  type ProcessOptions,
  type SelectOptions,
  processArticle,
  articleNeedsProcessing,
  listUnprocessedArticleIds,
} from "@/lib/processing/processor";
