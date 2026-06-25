/**
 * AI text moderation — safety contracts for free-text outputs (REF-067).
 *
 * Part of the AI safety/output package (`@/lib/ai/output`). Canonical home for
 * text moderation.
 *
 * Interactive features (the AI tutor, grammar-in-context) exchange free text
 * with the model, so their inputs and outputs can't be schema-validated the way
 * structured features (quiz/vocab/tags) are. {@link moderateText} is a cheap,
 * dependency-free, non-blocking heuristic check that flags obviously unsafe
 * content via a high-signal denylist. When something is flagged the caller
 * returns a safe fallback instead of the model text and persists nothing.
 *
 * Scope & limitations (documented in `docs/ai/ai-safety.md`):
 *   - This is a SAFETY NET, not a full moderation system. It targets a small set
 *     of unambiguous, high-harm categories to minimize false positives.
 *   - A real provider moderation endpoint (e.g. Azure AI Content Safety) can be
 *     layered in later behind {@link isRemoteModerationEnabled} without changing
 *     callers — this module stays provider-agnostic with no hard dependency.
 */

/** High-harm categories this heuristic screens for. */
export type ModerationCategory =
  | "self_harm"
  | "sexual_minors"
  | "violence_threat"
  | "weapons"
  | "hate";

export type ModerationResult = {
  /** Whether the text tripped the denylist. */
  flagged: boolean;
  /** Matched categories (empty when not flagged). */
  categories: ModerationCategory[];
};

/** User-facing replacement shown when content is flagged. Non-alarming. */
export const MODERATION_FALLBACK_MESSAGE =
  "I can't help with that. Let's keep things focused on learning English from this article.";

/**
 * High-signal patterns per category. Intentionally conservative — these match
 * explicit, unambiguous phrasing to avoid flagging legitimate article/learning
 * discussion (e.g. a news article mentioning "war" or "gun control" must NOT
 * trip the filter, so patterns require intent/instruction phrasing).
 */
const PATTERNS: Record<ModerationCategory, RegExp[]> = {
  self_harm: [
    /\bhow\s+(?:can|do|to)\s+i?\s*(?:kill|hurt|harm)\s+myself\b/i,
    /\bways?\s+to\s+(?:commit\s+suicide|end\s+my\s+life|kill\s+myself)\b/i,
    /\b(?:best|easiest|painless)\s+way\s+to\s+(?:die|kill\s+myself|commit\s+suicide)\b/i,
  ],
  sexual_minors: [
    /\b(?:child|minor|underage|preteen|pre-teen)\s+(?:porn|sex|nude|nudes|sexual)\b/i,
    /\bsexual(?:ly)?\s+(?:explicit\s+)?(?:content|acts?)\s+(?:with|involving)\s+(?:a\s+)?(?:child|minor|kid)\b/i,
  ],
  violence_threat: [
    /\bhow\s+(?:can|do|to)\s+i?\s*(?:kill|murder|attack|poison)\s+(?:someone|a\s+person|people|him|her|them)\b/i,
    /\bhelp\s+me\s+(?:kill|murder|attack|poison)\b/i,
    /\bplan(?:ning)?\s+(?:a\s+)?(?:mass\s+shooting|terror(?:ist)?\s+attack)\b/i,
  ],
  weapons: [
    /\bhow\s+(?:can|do|to)\s+i?\s*(?:make|build|construct|assemble)\s+(?:a\s+)?(?:bomb|explosive|ied|nerve\s+agent|bioweapon)\b/i,
    /\b(?:instructions?|recipe|steps?)\s+(?:for|to)\s+(?:making|building)\s+(?:a\s+)?(?:bomb|explosive|chemical\s+weapon)\b/i,
  ],
  hate: [
    /\b(?:kill|exterminate|gas|lynch)\s+(?:all\s+)?(?:the\s+)?(?:jews|muslims|blacks|gays|immigrants)\b/i,
  ],
};

/**
 * Screens free text against the denylist. Cheap (regex only) and synchronous so
 * it never blocks a request meaningfully. Returns the matched categories.
 */
export function moderateText(text: string): ModerationResult {
  if (typeof text !== "string" || !text.trim()) {
    return { flagged: false, categories: [] };
  }
  const categories: ModerationCategory[] = [];
  for (const [category, patterns] of Object.entries(PATTERNS) as [
    ModerationCategory,
    RegExp[],
  ][]) {
    if (patterns.some((re) => re.test(text))) {
      categories.push(category);
    }
  }
  return { flagged: categories.length > 0, categories };
}

/** Convenience: whether the given text is safe to show/persist. */
export function isTextSafe(text: string): boolean {
  return !moderateText(text).flagged;
}

/**
 * Whether an optional remote moderation provider is enabled via env. A future
 * integration (e.g. Azure AI Content Safety) can gate on this without changing
 * callers. Off by default; the heuristic always runs regardless.
 */
export function isRemoteModerationEnabled(): boolean {
  const v = process.env.AI_MODERATION_ENABLED?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}
