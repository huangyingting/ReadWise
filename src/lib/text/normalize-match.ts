/**
 * Stage-agnostic text normalizer for case/whitespace-insensitive matching.
 *
 * Shared by scraper cleanup/declutter heuristics so the matching contract
 * remains identical across pre-extraction and post-extraction stages.
 */
export function normalizeForTextMatch(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}
