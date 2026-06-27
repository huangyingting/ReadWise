/**
 * Goal Paths (#809) — deterministic, no-AI display copy.
 *
 * Maps each controlled {@link GoalPath} (plus the unset/null default) to:
 *   - a short Settings selector label + helper description,
 *   - path-specific Today heading + completion copy,
 *   - the comprehension-prompt label keyed by the path's `comprehensionCopyKey`.
 *
 * All strings are static English — no AI, no learner content. Importing this
 * module never reads the database.
 */
import type { GoalPath } from "@/lib/learning/goal-path";
import { GOAL_PATH_TUNING } from "@/lib/learning/goal-path";

/** Human-readable Settings labels for each goal path (selector options). */
export const GOAL_PATH_LABELS: Record<GoalPath, string> = {
  daily_news: "Daily News Reader",
  academic: "Academic Reading",
  business: "Business English",
  exam: "Exam Preparation",
  extensive: "Casual Extensive Reading",
};

/** One-line helper describing the intent of each path. */
export const GOAL_PATH_HELP: Record<GoalPath, string> = {
  daily_news: "Medium-length current-events articles around B1–B2.",
  academic: "Longer, more formal articles around B2–C1.",
  business: "Business, finance, and tech reading around B1–C1.",
  exam: "A variety of genres with a comprehension focus, B1–B2.",
  extensive: "Short, easy reads for relaxed, high-volume reading.",
};

/** Path-specific Today heading + completion copy. */
export type GoalPathTodayCopy = {
  /** Today page description / sub-heading. */
  heading: string;
  /** Completion-card body shown once the day's task is done. */
  completion: string;
};

/** Default (no goal path selected) Today copy — byte-identical to the originals. */
export const DEFAULT_TODAY_COPY: GoalPathTodayCopy = {
  heading:
    "One focused reading task for today. Read for enjoyment — there's no daily score to chase.",
  completion:
    "Nice work — you finished today's reading task. Keep the streak going whenever you're ready for more.",
};

/** Per-path Today copy (deterministic, no AI). */
export const GOAL_PATH_TODAY_COPY: Record<GoalPath, GoalPathTodayCopy> = {
  daily_news: {
    heading: "Today's news read — stay current with one focused article.",
    completion:
      "Nice — you stayed current today. Come back tomorrow for the next headline read.",
  },
  academic: {
    heading: "Today's deep read — one longer, formal article to study.",
    completion:
      "Great focus — another academic read done. Steady reading builds real fluency.",
  },
  business: {
    heading: "Today's business read — sharpen your professional English.",
    completion:
      "Done — you sharpened your business English today. See you tomorrow.",
  },
  exam: {
    heading: "Today's exam-prep read — practice reading under real conditions.",
    completion:
      "Practice logged — steady exam prep beats cramming. Back tomorrow for more.",
  },
  extensive: {
    heading: "Today's easy read — relax and enjoy a short article.",
    completion:
      "Lovely — you enjoyed a relaxed read today. Reading for pleasure counts too.",
  },
};

/** Comprehension-prompt label per `comprehensionCopyKey`. */
export const COMPREHENSION_PROMPT_COPY: Record<string, string> = {
  main_idea: "Main idea",
  argument_structure: "Argument structure",
  key_takeaway: "Key takeaway",
  comprehension_check: "Comprehension check",
  enjoyment: "How did you enjoy this?",
};

/** Resolve the Today copy for a (possibly null) goal path. */
export function todayCopyForGoalPath(goalPath: GoalPath | null): GoalPathTodayCopy {
  return goalPath ? GOAL_PATH_TODAY_COPY[goalPath] : DEFAULT_TODAY_COPY;
}

/** Resolve the comprehension-prompt label for a (possibly null) goal path. */
export function comprehensionPromptForGoalPath(goalPath: GoalPath | null): string {
  if (!goalPath) return "Comprehension check";
  const key = GOAL_PATH_TUNING[goalPath].comprehensionCopyKey;
  return COMPREHENSION_PROMPT_COPY[key] ?? "Comprehension check";
}
