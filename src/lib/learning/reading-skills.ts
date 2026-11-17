/**
 * Reading-skill taxonomy for comprehension questions (#1302).
 *
 * Six skills aligned to the College & Career Readiness anchor standards for
 * reading. Every `QuizQuestion` carries one skill (`skillTag`) and the derived
 * standard code. Client-safe: used by the quiz UI, browse filters, print
 * answer keys, and classroom skill analytics.
 *
 * The AI quiz prompt asks for a skill per question; when it is missing or
 * unrecognized, {@link classifyQuestionSkill} assigns one deterministically
 * from the question wording. The same ordered keyword rules back-filled
 * existing questions in the `20261117120000_reading_skills` migration —
 * keep `READING_SKILL_RULES` and that SQL in step (a test enforces it).
 */

export const READING_SKILLS = [
  { key: "textual_evidence", label: "Cite textual evidence", standardCode: "CCRA.R.1" },
  { key: "main_idea", label: "Main idea & summary", standardCode: "CCRA.R.2" },
  { key: "cause_effect", label: "Cause & effect", standardCode: "CCRA.R.3" },
  { key: "vocabulary_in_context", label: "Vocabulary in context", standardCode: "CCRA.R.4" },
  { key: "point_of_view", label: "Point of view & purpose", standardCode: "CCRA.R.6" },
  { key: "argument", label: "Argument & claims", standardCode: "CCRA.R.8" },
] as const;

export type ReadingSkill = (typeof READING_SKILLS)[number]["key"];

export const READING_SKILL_KEYS: readonly ReadingSkill[] = READING_SKILLS.map((skill) => skill.key);

/** Detail/evidence questions are the most common, so they are the fallback. */
export const DEFAULT_READING_SKILL: ReadingSkill = "textual_evidence";

/**
 * Ordered classification rules: the first rule whose keyword appears in the
 * lower-cased question wins; nothing matching means textual evidence.
 * Point of view is checked before cause & effect so "Why did the author…"
 * reads as purpose rather than causation.
 */
export const READING_SKILL_RULES: ReadonlyArray<{ skill: ReadingSkill; keywords: readonly string[] }> = [
  {
    skill: "vocabulary_in_context",
    keywords: ["closest in meaning", "the word", "the phrase", "the term", "meaning of", "most likely means", "mean?", "means?", "definition"],
  },
  {
    skill: "main_idea",
    keywords: ["main idea", "central idea", "mainly about", "mostly about", "primarily about", "main point", "summary", "summarize", "best title"],
  },
  {
    skill: "argument",
    keywords: ["argue", "argument", "claim", "convince", "persuade"],
  },
  {
    skill: "point_of_view",
    keywords: ["purpose", "point of view", "perspective", "the tone", "tone of", "attitude", "why did the author", "why does the author"],
  },
  {
    skill: "cause_effect",
    keywords: ["why", "cause", "because", "result", "effect", "lead to", "led to", "consequence"],
  },
];

const SKILL_BY_KEY = new Map<string, (typeof READING_SKILLS)[number]>(READING_SKILLS.map((skill) => [skill.key, skill]));

export function isReadingSkill(value: unknown): value is ReadingSkill {
  return typeof value === "string" && SKILL_BY_KEY.has(value);
}

export function readingSkillLabel(skill: ReadingSkill): string {
  return SKILL_BY_KEY.get(skill)!.label;
}

export function standardCodeFor(skill: ReadingSkill): string {
  return SKILL_BY_KEY.get(skill)!.standardCode;
}

/** Short anchor code for badges, e.g. "R.2". */
export function shortStandardCode(skill: ReadingSkill): string {
  return standardCodeFor(skill).replace(/^CCRA\./, "");
}

/** Deterministic skill for a question from its wording. */
export function classifyQuestionSkill(question: string): ReadingSkill {
  const text = question.toLowerCase();
  for (const rule of READING_SKILL_RULES) {
    if (rule.keywords.some((keyword) => text.includes(keyword))) return rule.skill;
  }
  return DEFAULT_READING_SKILL;
}

/**
 * Accepts a model-provided skill as a key ("main_idea"), a label-ish phrase
 * ("Main idea"), or an anchor code ("R.2" / "CCRA.R.2"); anything else falls
 * back to classifying the question text.
 */
export function normalizeReadingSkill(value: unknown, question: string): ReadingSkill {
  if (typeof value === "string") {
    const raw = value.trim().toLowerCase();
    const asKey = raw.replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");
    if (isReadingSkill(asKey)) return asKey;
    const code = raw.replace(/^ccra\./, "").toUpperCase();
    const byCode = READING_SKILLS.find((skill) => skill.standardCode === `CCRA.${code}`);
    if (byCode) return byCode.key;
    const byLabel = READING_SKILLS.find((skill) => skill.label.toLowerCase().startsWith(raw) && raw.length >= 4);
    if (byLabel) return byLabel.key;
  }
  return classifyQuestionSkill(question);
}
