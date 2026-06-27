/**
 * Privacy-safe learning coach memory (#810).
 *
 * A constrained, long-term learner memory made of **structured weakness
 * summaries only**, so Tutor framing and weekly study-plan recommendations can
 * improve over time WITHOUT storing any private content.
 *
 * One row per `(userId, skill)` in `LearnerCoachMemory`. Every entry stores
 * ONLY aggregated signals — a controlled skill key, a 0–1 confidence estimate,
 * a bounded evidence count, a last-observed timestamp, and a controlled trend
 * direction. Prompts, article text, selected text, question/answer text,
 * definitions, examples, notes, tokens, ids, and PII are BANNED — both by the
 * schema and by {@link upsertCoachMemory}'s allowlist guard.
 *
 * Rows are updated as **best-effort side effects** of `SkillMastery` writes
 * (see {@link syncCoachMemory}); a failure here must never break the underlying
 * learning action.
 */

import { prisma } from "@/lib/prisma";
import { clamp01, bestEffortMastery } from "./primitives";

// ---------------------------------------------------------------------------
// Controlled vocabularies
// ---------------------------------------------------------------------------

/**
 * Allowed skill keys: the six `SkillMastery` skills plus two reading-specific
 * comprehension dimensions. Any other key is rejected.
 */
export const COACH_MEMORY_SKILLS = [
  "reading",
  "vocabulary",
  "grammar",
  "listening",
  "pronunciation",
  "comprehension",
  "main_idea",
  "inference",
] as const;

export type CoachMemorySkill = (typeof COACH_MEMORY_SKILLS)[number];

export function isCoachMemorySkill(value: unknown): value is CoachMemorySkill {
  return (
    typeof value === "string" &&
    (COACH_MEMORY_SKILLS as readonly string[]).includes(value)
  );
}

/** Controlled trend directions. */
export const COACH_MEMORY_TRENDS = ["improving", "stable", "declining"] as const;
export type CoachMemoryTrend = (typeof COACH_MEMORY_TRENDS)[number];

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/** evidenceCount is capped before persistence to prevent runaway accumulation. */
export const EVIDENCE_COUNT_CAP = 100;

/** Entries not updated in more than this many days are treated as "stale". */
export const STALE_AFTER_DAYS = 90;

/** Stale entries' weakness signal is weighted at this fraction (50%). */
export const STALE_WEIGHT = 0.5;

/** Smoothing factor for the confidence EMA blend. */
const BLEND_ALPHA = 0.3;

/** Minimum confidence delta before a trend is reported as up/down. */
const TREND_DELTA = 0.05;

/** Bounded token budget for the Tutor context summary string. */
export const MAX_TUTOR_CONTEXT_TOKENS = 200;

/** Maximum skill lines surfaced in the Tutor context summary. */
const MAX_TUTOR_CONTEXT_LINES = 6;

const TUTOR_CONTEXT_HEADER = "Skill weaknesses (structured summary only):";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Privacy guard
// ---------------------------------------------------------------------------

/** Thrown when {@link upsertCoachMemory} is given a forbidden / unexpected field. */
export class CoachMemoryPrivacyError extends Error {
  constructor(key: string) {
    super(
      `coach memory rejects forbidden field "${key}" — only aggregated skill ` +
        `signals (skill, confidence, observedAt) may be persisted`,
    );
    this.name = "CoachMemoryPrivacyError";
  }
}

/**
 * The ONLY input keys coach memory accepts. Anything else — `prompt`, `text`,
 * `definition`, `example`, `contextSentence`, `note`, `token`, `articleId`,
 * `sessionId`, `questionId`, `answer`, PII, etc. — is rejected with a typed
 * {@link CoachMemoryPrivacyError}. An allowlist (rather than a denylist) keeps
 * the privacy boundary closed by default.
 */
const ALLOWED_INPUT_KEYS = new Set(["skill", "confidence", "observedAt"]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The only structured fields accepted by {@link upsertCoachMemory}. */
export type CoachMemoryInput = {
  /** Controlled skill key (see {@link COACH_MEMORY_SKILLS}). */
  skill: CoachMemorySkill | string;
  /** 0–1 observation of competence (higher = stronger). */
  confidence: number;
  /** Timestamp of the evidence event (defaults to now). */
  observedAt?: Date;
};

/** Controlled, export-safe projection of a coach-memory row. */
export type CoachMemoryRecord = {
  skill: string;
  confidence: number;
  evidenceCount: number;
  lastObservedAt: Date;
  trend: CoachMemoryTrend;
  createdAt: Date;
};

const RECORD_SELECT = {
  skill: true,
  confidence: true,
  evidenceCount: true,
  lastObservedAt: true,
  trend: true,
  createdAt: true,
} as const;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function assertNoForbiddenFields(input: object): void {
  for (const key of Object.keys(input)) {
    if (!ALLOWED_INPUT_KEYS.has(key)) {
      throw new CoachMemoryPrivacyError(key);
    }
  }
}

function computeTrend(prev: number | null, next: number): CoachMemoryTrend {
  if (prev === null) return "stable";
  if (next > prev + TREND_DELTA) return "improving";
  if (next < prev - TREND_DELTA) return "declining";
  return "stable";
}

/** True when an entry has not been refreshed within {@link STALE_AFTER_DAYS}. */
export function isStale(lastObservedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - lastObservedAt.getTime() > STALE_AFTER_DAYS * MS_PER_DAY;
}

/**
 * Effective confidence used for ranking. Stale entries' weakness (distance
 * below 1.0) is weighted at {@link STALE_WEIGHT}, so an old weakness counts for
 * less than a fresh one without being discarded.
 */
export function effectiveConfidence(
  confidence: number,
  lastObservedAt: Date,
  now: Date = new Date(),
): number {
  const c = clamp01(confidence);
  if (!isStale(lastObservedAt, now)) return c;
  return clamp01(1 - (1 - c) * STALE_WEIGHT);
}

/** Rough token estimate (~4 chars/token) for bounding the summary string. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Creates or updates the `(userId, skill)` coach-memory entry from a single
 * aggregated observation. Confidence is blended via an EMA, `evidenceCount` is
 * bumped and capped at {@link EVIDENCE_COUNT_CAP}, and `trend` is recomputed
 * from the confidence delta.
 *
 * Rejects any input object carrying a field outside the {@link ALLOWED_INPUT_KEYS}
 * allowlist with a typed {@link CoachMemoryPrivacyError} — this is the privacy
 * boundary that keeps private content out of long-term memory.
 *
 * Returns the controlled record, or `null` when the skill key is not in the
 * controlled vocabulary (the observation is silently dropped).
 */
export async function upsertCoachMemory(
  userId: string,
  input: CoachMemoryInput,
): Promise<CoachMemoryRecord | null> {
  assertNoForbiddenFields(input);

  if (!isCoachMemorySkill(input.skill)) return null;
  const skill = input.skill;
  const observed = clamp01(input.confidence);
  const observedAt = input.observedAt ?? new Date();

  const existing = await prisma.learnerCoachMemory.findUnique({
    where: { userId_skill: { userId, skill } },
    select: { confidence: true, evidenceCount: true },
  });

  const prevConfidence = existing ? existing.confidence : null;
  const confidence = existing
    ? clamp01(existing.confidence * (1 - BLEND_ALPHA) + observed * BLEND_ALPHA)
    : observed;
  const evidenceCount = Math.min(
    EVIDENCE_COUNT_CAP,
    (existing?.evidenceCount ?? 0) + 1,
  );
  const trend = computeTrend(prevConfidence, confidence);

  const data = { confidence, evidenceCount, trend, lastObservedAt: observedAt };

  const row = await prisma.learnerCoachMemory.upsert({
    where: { userId_skill: { userId, skill } },
    create: { userId, skill, ...data },
    update: data,
    select: RECORD_SELECT,
  });

  return row as CoachMemoryRecord;
}

/**
 * Best-effort coach-memory sync hooked off a `SkillMastery` write. A failure is
 * swallowed and logged — it must NEVER break the underlying mastery flow.
 */
export async function syncCoachMemory(
  userId: string,
  skill: string,
  confidence: number,
): Promise<void> {
  await bestEffortMastery("coach_memory.sync", () =>
    upsertCoachMemory(userId, { skill, confidence }),
  );
}

/**
 * Hard-deletes every coach-memory row for the user (user-facing "clear learning
 * memory"). Does NOT touch `SkillMastery`, which remains the source of truth.
 * Returns the number of rows removed.
 */
export async function deleteCoachMemory(userId: string): Promise<number> {
  const { count } = await prisma.learnerCoachMemory.deleteMany({
    where: { userId },
  });
  return count;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Returns all controlled coach-memory records for the user. */
export async function listCoachMemory(
  userId: string,
): Promise<CoachMemoryRecord[]> {
  const rows = await prisma.learnerCoachMemory.findMany({
    where: { userId },
    select: RECORD_SELECT,
  });
  return rows as CoachMemoryRecord[];
}

/**
 * Returns a `skill → effectiveConfidence` map (stale-weighted) for the study
 * plan to rank weak areas. An EMPTY map means "no memory yet" — callers MUST
 * fall back to `SkillMastery` so existing behaviour is unchanged.
 */
export async function coachMemorySkillConfidences(
  userId: string,
  now: Date = new Date(),
): Promise<Map<string, number>> {
  const rows = await listCoachMemory(userId);
  const out = new Map<string, number>();
  for (const r of rows) {
    out.set(r.skill, effectiveConfidence(r.confidence, r.lastObservedAt, now));
  }
  return out;
}

/**
 * Builds the bounded, plain-text Tutor context summary from coach-memory rows.
 *
 * Output contains ONLY controlled aggregates (skill key, confidence, trend,
 * observation count) — never prompts, text, ids, or any private content — and
 * is capped at {@link MAX_TUTOR_CONTEXT_TOKENS}. Weakest skills come first;
 * stale entries are down-weighted in the ranking. Returns "" when there is no
 * memory (cold start → Tutor behaviour unchanged).
 */
export async function buildTutorContext(
  userId: string,
  now: Date = new Date(),
): Promise<string> {
  const rows = await listCoachMemory(userId);
  if (rows.length === 0) return "";

  const ranked = rows
    .map((r) => ({
      r,
      // Higher weakness = weaker = ranked first. Stale entries weigh less.
      weakness: 1 - effectiveConfidence(r.confidence, r.lastObservedAt, now),
    }))
    .sort((a, b) => b.weakness - a.weakness)
    .slice(0, MAX_TUTOR_CONTEXT_LINES);

  const lines: string[] = [];
  let used = estimateTokens(TUTOR_CONTEXT_HEADER);
  for (const { r } of ranked) {
    const line = `- ${r.skill}: confidence ${r.confidence.toFixed(2)} (${r.trend}, ${r.evidenceCount} observations)`;
    const cost = estimateTokens(line) + 1;
    if (used + cost > MAX_TUTOR_CONTEXT_TOKENS) break;
    used += cost;
    lines.push(line);
  }

  if (lines.length === 0) return "";
  return [TUTOR_CONTEXT_HEADER, ...lines].join("\n");
}
