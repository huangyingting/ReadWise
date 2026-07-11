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

const TITLE_CASE_MINOR_WORDS = new Set(["and", "or", "of", "the", "a", "an", "to", "in", "on", "for", "with"]);

/**
 * Recovers the first syntactically valid JSON array from a model response,
 * tolerating markdown code fences and surrounding prose. Uses a bounded scanner
 * that tracks bracket nesting and JSON string escape state to find balanced
 * array candidates. Invalid balanced candidates (e.g. bracketed prose) are
 * skipped; the first candidate that parses as a JSON array is returned.
 * Returns null when no parseable array is found.
 */
export function extractJsonArray(raw: string): unknown[] | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/```(?:json)?/gi, "").trim();

  let pos = 0;
  while (pos < text.length) {
    const start = text.indexOf("[", pos);
    if (start === -1) break;

    // Scan forward from this '[' tracking depth and string state.
    const end = findMatchingBracket(text, start);
    if (end === -1) {
      // No balanced close found from this position; no further candidates.
      break;
    }

    const candidate = text.slice(start, end + 1);
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Not valid JSON — skip past this candidate and try next '['.
    }
    pos = start + 1;
  }

  return null;
}

/**
 * Scans from an opening '[' at `start` and returns the index of the matching
 * ']', respecting nested brackets/braces and JSON string escaping. Returns -1
 * if the input is unbalanced or malformed beyond recovery.
 */
function findMatchingBracket(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  const len = text.length;

  for (let i = start; i < len; i++) {
    const ch = text.charCodeAt(i);

    if (inString) {
      if (ch === 0x5c /* backslash */) {
        // Skip the escaped character (handles \\, \", \/, \n, \uXXXX, etc.)
        i++;
        continue;
      }
      if (ch === 0x22 /* " */) {
        inString = false;
      }
      continue;
    }

    // Outside a string
    switch (ch) {
      case 0x22: // "
        inString = true;
        break;
      case 0x5b: // [
      case 0x7b: // {
        depth++;
        break;
      case 0x5d: // ]
      case 0x7d: // }
        depth--;
        if (depth === 0) return i;
        if (depth < 0) return -1;
        break;
    }
  }

  return -1;
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

/**
 * Title-cases a tag name: each word's first alphanumeric character uppercased,
 * the rest lowercased. Small connective words stay lowercased unless leading.
 * Keeps existing intra-word capitalization minimal so "AI" → "Ai" is avoided by
 * preserving all-caps tokens of length <= 3.
 */
export function toTitleCase(name: string): string {
  const words = name.trim().split(/\s+/);
  return words
    .map((word, i) => {
      if (!word) return word;
      // Preserve short all-caps acronyms (AI, US, UK, EU).
      if (word.length <= 3 && word === word.toUpperCase() && /[A-Z]/.test(word)) {
        return word;
      }
      const lower = word.toLowerCase();
      if (i > 0 && TITLE_CASE_MINOR_WORDS.has(lower)) return lower;
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
    if (!isRecord(row)) {
      rejected++;
      continue;
    }
    const word = asTrimmedString(row.word);
    const explanation = asTrimmedString(row.explanation);
    const example = asTrimmedString(row.example);
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
    if (!isRecord(row)) {
      rejected++;
      continue;
    }
    const question = asTrimmedString(row.question);
    const rawOptions = Array.isArray(row.options) ? row.options : [];
    const options = rawOptions
      .map((o) => asTrimmedString(o))
      .filter((o) => o.length > 0);
    const correctIndex =
      typeof row.correctIndex === "number" ? Math.trunc(row.correctIndex) : -1;

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
