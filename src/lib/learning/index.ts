/**
 * Learning subsystem — public API barrel (REF-028).
 *
 * Groups all mastery, SRS, study-plan, and review modules under a single
 * cohesive subsystem boundary. Individual modules remain importable directly
 * for focused use; this barrel is the convenience entry point for code that
 * needs several learning APIs together.
 *
 * Ownership:
 *   - SRS scheduling + flashcard review loop
 *   - Word/article/skill/quiz mastery progression
 *   - Study plan diagnostics + review assets
 *
 * Internals such as shared primitives, generic validation helpers, and
 * practice-attempt plumbing remain submodule-only imports.
 */

export * from "./srs";
export * from "./cloze";
export * from "./word-mastery";
export * from "./article-mastery";
export * from "./skill-mastery";
export * from "./quiz-mastery";
export * from "./flashcards";
export * from "./review-assets";
export type {
  WeakAreaKind,
  WeakArea,
  StudyPlanItem,
  StudyPlan,
  StudyReadingRec,
  StudyDiagnostics,
} from "./study-plan";
export {
  WEAK_WORD_FAMILIARITY,
  LOW_COMPREHENSION,
  diagnoseWeakAreas,
  buildWeeklyPlan,
  gatherStudyDiagnostics,
  generateStudyPlan,
} from "./study-plan";
