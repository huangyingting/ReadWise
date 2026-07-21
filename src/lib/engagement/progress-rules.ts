/**
 * Pure reading-progress rules shared by server writes, Today integration, and
 * offline conflict resolution.
 */

/** Scroll percent at/above which an article is considered finished. */
export const COMPLETION_THRESHOLD = 95;

export function isCompletePercent(percent: number): boolean {
  return percent >= COMPLETION_THRESHOLD;
}
