/**
 * Annotation re-anchoring core (#1103) — pure, side-effect-free.
 *
 * When an audited force-rescrape prepares a replacement Article content version,
 * every content-position dependent annotation (highlight/note anchor) must be
 * re-anchored onto the PROPOSED plain text BEFORE the version can activate. This
 * module builds that decision on top of the existing Reader re-anchoring engine
 * ({@link revalidateAnchor}) — it does NOT invent a second annotation format.
 *
 * The net-new logic #1103 adds is AMBIGUITY DETECTION. `revalidateAnchor`'s
 * "moved" path falls back to the FIRST `indexOf` when context does not uniquely
 * match, which for REPEATED text can latch onto the WRONG occurrence. A reliable
 * migration must never move an anchor arbitrarily, so an anchor is treated as
 * RELIABLE only when:
 *   - it is "valid" (still sits exactly at its offsets), OR
 *   - it is "moved" AND its new location is UNAMBIGUOUS — either the quote occurs
 *     exactly once, or (for repeated quotes) the prefix+quote+suffix context
 *     resolves to exactly one location, or (for a reflowed quote) the
 *     whitespace-tolerant match is unique.
 * Everything else ("missing", or a "moved" quote whose location cannot be
 * uniquely resolved) is UNRELIABLE → it blocks activation and is surfaced for
 * confirmation instead of being dropped or moved arbitrarily (AC2).
 *
 * PRIVACY: nothing here reads or emits quote/note text into anything durable.
 * The plan carries anchor IDs + counts + target offsets only — never content.
 */
import { revalidateAnchor } from "@/lib/offline-conflict";

/** Minimal anchor shape needed to re-anchor a highlight/note onto new content. */
export interface ReanchorAnchorInput {
  id: string;
  /** Owner — collisions are only possible within a single user's anchors. */
  userId: string;
  quote: string;
  startOffset: number;
  endOffset: number;
  prefix?: string | null;
  suffix?: string | null;
}

/**
 * Reliability classification for a single anchor against the proposed content:
 *   - "exact":     quote still sits at its stored offsets (no move needed).
 *   - "moved":     quote relocated to an UNAMBIGUOUS position (offsets updated).
 *   - "ambiguous": quote exists but its position cannot be uniquely resolved
 *                  (repeated text / non-unique context) — unreliable.
 *   - "missing":   quote is gone entirely — unreliable.
 */
export type ReanchorReliability = "exact" | "moved" | "ambiguous" | "missing";

export interface ReanchorAssessment {
  id: string;
  userId: string;
  reliability: ReanchorReliability;
  /** True for "exact" and "moved"; false for "ambiguous" and "missing". */
  reliable: boolean;
  /** Offsets the anchor should occupy on the NEW content when reliable. */
  targetStartOffset: number;
  targetEndOffset: number;
  /** True when a reliable anchor's target differs from its stored offsets. */
  moved: boolean;
}

/** A concrete offset update to apply inside the activation transaction. */
export interface AnchorMove {
  id: string;
  userId: string;
  startOffset: number;
  endOffset: number;
}

/**
 * The aggregate re-anchoring decision for one Article's proposed content
 * version. IDs + counts + offsets only — never quote/note text.
 */
export interface ReanchorPlan {
  total: number;
  reliableCount: number;
  unreliableCount: number;
  /** IDs of anchors that could not be reliably re-anchored (block activation). */
  unresolvedAnchorIds: string[];
  /** Offset updates for reliable anchors that moved (applied atomically). */
  moves: AnchorMove[];
  /** True when every anchor migrated reliably (gate may pass). */
  allReliable: boolean;
}

/** Escape a string for safe embedding in a RegExp (mirrors offline-conflict). */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Count NON-overlapping occurrences of `needle` in `haystack`, capped at 2 —
 * callers only ever need to distinguish "none" (0), "unique" (1) and
 * "repeated" (>=2), so there is no reason to scan the whole document.
 */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    if (count >= 2) break;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

/**
 * Count whitespace-tolerant occurrences of `quote` (its tokens separated by any
 * run of whitespace), capped at 2. Mirrors {@link revalidateAnchor}'s reflow
 * fallback so a uniquely reflowed quote is treated as a reliable move.
 */
function countWhitespaceTolerant(quote: string, plainText: string): number {
  const tokens = quote
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (tokens.length === 0) return 0;
  const flexible = new RegExp(tokens.map(escapeRegExp).join("\\s+"), "g");
  let count = 0;
  while (flexible.exec(plainText) !== null) {
    count += 1;
    if (count >= 2) break;
  }
  return count;
}

function unreliableAssessment(
  anchor: ReanchorAnchorInput,
  reliability: "ambiguous" | "missing",
): ReanchorAssessment {
  return {
    id: anchor.id,
    userId: anchor.userId,
    reliability,
    reliable: false,
    targetStartOffset: anchor.startOffset,
    targetEndOffset: anchor.endOffset,
    moved: false,
  };
}

/**
 * Classify a single anchor against the proposed plain text. Reuses
 * {@link revalidateAnchor} for the match, then layers ambiguity detection on
 * top so a non-unique "moved" result is never treated as a confident move.
 */
export function assessAnchor(
  anchor: ReanchorAnchorInput,
  plainText: string,
): ReanchorAssessment {
  const result = revalidateAnchor(
    {
      quote: anchor.quote,
      startOffset: anchor.startOffset,
      endOffset: anchor.endOffset,
      prefix: anchor.prefix ?? undefined,
      suffix: anchor.suffix ?? undefined,
    },
    plainText,
  );

  if (result.status === "valid") {
    return {
      id: anchor.id,
      userId: anchor.userId,
      reliability: "exact",
      reliable: true,
      targetStartOffset: anchor.startOffset,
      targetEndOffset: anchor.endOffset,
      moved: false,
    };
  }

  if (result.status === "missing") {
    return unreliableAssessment(anchor, "missing");
  }

  // result.status === "moved" — decide whether the new location is UNAMBIGUOUS.
  const quote = anchor.quote ?? "";
  const quoteCount = countOccurrences(plainText, quote);
  let reliable: boolean;
  if (quoteCount === 1) {
    // Exactly one occurrence anywhere → the move is unambiguous.
    reliable = true;
  } else if (quoteCount >= 2) {
    // Repeated text: only reliable when the stored context pins ONE location.
    const prefix = anchor.prefix ?? "";
    const suffix = anchor.suffix ?? "";
    reliable =
      (prefix.length > 0 || suffix.length > 0) &&
      countOccurrences(plainText, `${prefix}${quote}${suffix}`) === 1;
  } else {
    // Matched only via the whitespace-tolerant reflow fallback.
    reliable = countWhitespaceTolerant(quote, plainText) === 1;
  }

  if (!reliable) {
    return unreliableAssessment(anchor, "ambiguous");
  }

  const targetStartOffset = result.suggestedStartOffset ?? anchor.startOffset;
  const targetEndOffset = result.suggestedEndOffset ?? anchor.endOffset;
  return {
    id: anchor.id,
    userId: anchor.userId,
    reliability: "moved",
    reliable: true,
    targetStartOffset,
    targetEndOffset,
    moved:
      targetStartOffset !== anchor.startOffset ||
      targetEndOffset !== anchor.endOffset,
  };
}

/**
 * Guard the `@@unique([userId, articleId, startOffset, endOffset])` constraint:
 * if two reliable anchors for the SAME user would land on identical offsets, at
 * most one may keep the slot. An "exact" anchor already legitimately occupies
 * those offsets, so it wins; every colliding MOVED anchor is demoted to
 * ambiguous (unreliable) rather than being moved arbitrarily. Demoting a moved
 * anchor cannot create a new collision, so a single pass suffices.
 */
function resolveCollisions(assessments: ReanchorAssessment[]): void {
  const byUserOffset = new Map<string, ReanchorAssessment[]>();
  for (const assessment of assessments) {
    if (!assessment.reliable) continue;
    const key = `${assessment.userId}:${assessment.targetStartOffset}:${assessment.targetEndOffset}`;
    const bucket = byUserOffset.get(key);
    if (bucket) bucket.push(assessment);
    else byUserOffset.set(key, [assessment]);
  }

  for (const bucket of byUserOffset.values()) {
    if (bucket.length <= 1) continue;
    const keeper = bucket.find((a) => a.reliability === "exact");
    for (const assessment of bucket) {
      if (keeper && assessment === keeper) continue;
      assessment.reliability = "ambiguous";
      assessment.reliable = false;
      assessment.moved = false;
    }
  }
}

/**
 * Assess every anchor and resolve offset collisions. Exposed for granular
 * testing of the classification; {@link buildReanchorPlan} aggregates the
 * result into the gate/activation decision.
 */
export function assessAnchors(
  anchors: ReanchorAnchorInput[],
  plainText: string,
): ReanchorAssessment[] {
  const assessments = anchors.map((anchor) => assessAnchor(anchor, plainText));
  resolveCollisions(assessments);
  return assessments;
}

/**
 * Build the aggregate re-anchoring plan for one Article's proposed content
 * version. When `allReliable` is false the caller MUST block activation, retain
 * the old version, and surface `unresolvedAnchorIds` for confirmation.
 */
export function buildReanchorPlan(
  anchors: ReanchorAnchorInput[],
  plainText: string,
): ReanchorPlan {
  const assessments = assessAnchors(anchors, plainText);
  const unresolvedAnchorIds: string[] = [];
  const moves: AnchorMove[] = [];
  let reliableCount = 0;

  for (const assessment of assessments) {
    if (!assessment.reliable) {
      unresolvedAnchorIds.push(assessment.id);
      continue;
    }
    reliableCount += 1;
    if (assessment.moved) {
      moves.push({
        id: assessment.id,
        userId: assessment.userId,
        startOffset: assessment.targetStartOffset,
        endOffset: assessment.targetEndOffset,
      });
    }
  }

  return {
    total: assessments.length,
    reliableCount,
    unreliableCount: unresolvedAnchorIds.length,
    unresolvedAnchorIds,
    moves,
    allReliable: unresolvedAnchorIds.length === 0,
  };
}
