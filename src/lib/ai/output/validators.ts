/**
 * AI output validators — structured-output safety contracts (REF-067).
 *
 * Part of the AI safety/output package (`@/lib/ai/output`). Canonical home for
 * all structured AI output validators: vocabulary, quiz, and tags.
 *
 * Structured AI outputs (vocabulary, quiz, tags) are shown to learners and must
 * never be cached/persisted unless they pass strict, schema-level validation.
 * This module is the single source of truth for those rules: it strengthens the
 * previously per-feature fence-tolerant parsers into strict validators that
 * reject malformed, empty, or partially-valid items.
 *
 * Design:
 *   - "Fence-tolerant": the model often wraps JSON in ```json fences or prose;
 *     {@link extractJsonArray} recovers the first top-level JSON array.
 *   - "Reject, don't trust": each item is validated field-by-field. Invalid
 *     items are DROPPED (and counted in `rejected`) rather than coerced. A batch
 *     that ends up empty is treated as a generation failure by the caller, which
 *     declines to cache it (the project's `fallback:true` convention).
 *   - No prompt/response content is logged here; callers decide what to surface.
 */

/** A validated vocabulary item. `example` may be empty but the others may not. */
export type ValidatedVocabularyItem = {
  word: string;
  explanation: string;
  example: string;
};

/** A validated multiple-choice quiz question. */
export type ValidatedQuizQuestion = {
  question: string;
  options: string[];
  correctIndex: number;
};

/** The result of validating a structured array: kept items + rejected count. */
export type ValidationReport<T> = {
  /** Items that passed validation, deduped where applicable. */
  items: T[];
  /** Count of array entries dropped for being malformed/duplicate/invalid. */
  rejected: number;
};

/**
 * Recovers the first top-level JSON array from a model response, tolerating
 * markdown code fences and surrounding prose. Returns null when no parseable
 * array is found.
 */
export function extractJsonArray(raw: string): unknown[] | null {
  if (typeof raw !== "string") return null;
  const fenced = raw.replace(/```(?:json)?/gi, "").trim();
  const start = fenced.indexOf("[");
  const end = fenced.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return null;
  }
  return Array.isArray(parsed) ? parsed : null;
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Title-cases a tag name: each word's first alphanumeric character uppercased,
 * the rest lowercased. Small connective words stay lowercased unless leading.
 * Keeps existing intra-word capitalization minimal so "AI" → "Ai" is avoided by
 * preserving all-caps tokens of length <= 3.
 */
export function toTitleCase(name: string): string {
  const minor = new Set(["and", "or", "of", "the", "a", "an", "to", "in", "on", "for", "with"]);
  const words = name.trim().split(/\s+/);
  return words
    .map((word, i) => {
      if (!word) return word;
      // Preserve short all-caps acronyms (AI, US, UK, EU).
      if (word.length <= 3 && word === word.toUpperCase() && /[A-Z]/.test(word)) {
        return word;
      }
      const lower = word.toLowerCase();
      if (i > 0 && minor.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/**
 * Validates a model vocabulary response. Each item must be an object with a
 * non-empty `word` and `explanation`; `example` is optional. Duplicate words
 * (case-insensitive) are dropped. Returns kept items + rejected count.
 */
export function validateVocabulary(raw: string): ValidationReport<ValidatedVocabularyItem> {
  const arr = extractJsonArray(raw);
  if (!arr) return { items: [], rejected: 0 };

  const seen = new Set<string>();
  const items: ValidatedVocabularyItem[] = [];
  let rejected = 0;
  for (const row of arr) {
    if (!row || typeof row !== "object") {
      rejected++;
      continue;
    }
    const record = row as Record<string, unknown>;
    const word = asTrimmedString(record.word);
    const explanation = asTrimmedString(record.explanation);
    const example = asTrimmedString(record.example);
    if (!word || !explanation) {
      rejected++;
      continue;
    }
    const key = word.toLowerCase();
    if (seen.has(key)) {
      rejected++;
      continue;
    }
    seen.add(key);
    items.push({ word, explanation, example });
  }
  return { items, rejected };
}

/**
 * Validates a model quiz response. Each question must have a non-empty prompt,
 * at least two distinct non-empty options, and a `correctIndex` that points at a
 * real option. Duplicate questions (case-insensitive) are dropped. Returns kept
 * questions + rejected count.
 */
export function validateQuiz(raw: string): ValidationReport<ValidatedQuizQuestion> {
  const arr = extractJsonArray(raw);
  if (!arr) return { items: [], rejected: 0 };

  const seen = new Set<string>();
  const items: ValidatedQuizQuestion[] = [];
  let rejected = 0;
  for (const row of arr) {
    if (!row || typeof row !== "object") {
      rejected++;
      continue;
    }
    const record = row as Record<string, unknown>;
    const question = asTrimmedString(record.question);
    const rawOptions = Array.isArray(record.options) ? record.options : [];
    const options = rawOptions
      .map((o) => asTrimmedString(o))
      .filter((o) => o.length > 0);
    const correctIndex =
      typeof record.correctIndex === "number" ? Math.trunc(record.correctIndex) : -1;

    if (
      !question ||
      options.length < 2 ||
      correctIndex < 0 ||
      correctIndex >= options.length
    ) {
      rejected++;
      continue;
    }

    const key = question.toLowerCase();
    if (seen.has(key)) {
      rejected++;
      continue;
    }
    seen.add(key);
    items.push({ question, options, correctIndex });
  }
  return { items, rejected };
}

/**
 * Validates a model tag response into a deduped list of Title-Cased tag names.
 * Each entry must be a non-empty string that yields a non-empty slug.
 * `slugify` is injected so the caller's canonical slug rules decide duplicates.
 */
export function validateTags(
  raw: string,
  slugify: (name: string) => string,
): ValidationReport<string> {
  const arr = extractJsonArray(raw);
  if (!arr) return { items: [], rejected: 0 };

  const seen = new Set<string>();
  const items: string[] = [];
  let rejected = 0;
  for (const row of arr) {
    const name = asTrimmedString(row);
    if (!name) {
      rejected++;
      continue;
    }
    const slug = slugify(name);
    if (!slug || seen.has(slug)) {
      rejected++;
      continue;
    }
    seen.add(slug);
    items.push(toTitleCase(name));
  }
  return { items, rejected };
}
