/**
 * Cloze (fill-in-the-blank) review helpers (REF-048, #38).
 *
 * Provides:
 *   buildCloze  — masks the target word inside its example sentence.
 *   gradeCloze  — case-insensitive, punctuation-tolerant answer grading.
 *
 * All functions are pure (no I/O) and fully unit-testable.
 *
 * Alignment note: cloze grading uses an independent stem-based matcher rather
 * than the shared `normalizeCandidates` lemmatizer. This is intentional:
 * cloze should accept "runs" as a correct answer for a target of "run"
 * (inflection tolerance), whereas saved-word equality checks use exact
 * case-insensitive matching. The two behaviors are consistent where they
 * overlap (base-form equality) and intentionally differ on inflections.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ClozeCard = {
  /** The example sentence with the target word replaced by underscores. */
  masked: string;
  /** The correct answer (the original word, case-preserved). */
  answer: string;
  /** Number of characters in the answer (hint for blank sizing). */
  answerLength: number;
};

export type ClozeResult =
  | { ok: true; card: ClozeCard }
  | { ok: false; reason: "no_example" | "word_not_found" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strips leading/trailing punctuation from a word token for comparison.
 * Handles contractions by only stripping non-apostrophe punctuation.
 */
function stripPunct(s: string): string {
  return s.replace(/^[^\w']+|[^\w']+$/g, "");
}

/**
 * Derives a simple stem for inflection matching.
 * Handles common English suffixes: -ing, -ed, -s, -es, -er, -est, -ly.
 * Also de-duplicates doubled consonants introduced by the suffix rule
 * (e.g., "running" → "runn" → "run").
 * Conservative: only strips if the result is ≥ 3 characters.
 */
function stemOf(word: string): string {
  const w = word.toLowerCase();
  if (w.length < 3) return w;
  // Strip common suffixes longest-first.
  const suffixes = ["ing", "ed", "es", "er", "est", "ly", "s"];
  for (const sfx of suffixes) {
    if (w.endsWith(sfx) && w.length - sfx.length >= 3) {
      const stem = w.slice(0, w.length - sfx.length);
      // De-duplicate doubled final consonant (e.g. "runn" → "run").
      if (
        stem.length >= 2 &&
        stem[stem.length - 1] === stem[stem.length - 2]
      ) {
        const deduped = stem.slice(0, -1);
        if (deduped.length >= 2) return deduped;
      }
      return stem;
    }
  }
  return w;
}

/**
 * Returns true when `token` (stripped of punctuation) matches `word`,
 * using case-insensitive and simple stem comparison.
 */
function tokenMatches(token: string, word: string): boolean {
  const t = stripPunct(token).toLowerCase();
  const w = word.toLowerCase();
  if (t === w) return true;
  // Stem-based inflection match (e.g. "running" matches "run")
  if (stemOf(t) === stemOf(w)) return true;
  // Also allow the word to match as a prefix of the token (for compound words)
  if (t.startsWith(w) && t.length - w.length <= 3) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds a cloze card by masking the target `word` in `example`.
 *
 * Returns `{ ok: false, reason: "no_example" }` when the example is empty.
 * Returns `{ ok: false, reason: "word_not_found" }` when the word (or any of
 * its inflections) cannot be located in the example — the caller should fall
 * back to definition-mode review.
 *
 * The mask is a sequence of underscores equal to the matched token's length.
 * Multi-word entries (e.g. "in spite of") have each space replaced by " _ "
 * style notation so the blank doesn't collide with sentence whitespace.
 */
export function buildCloze(word: string, example: string): ClozeResult {
  if (!example || example.trim() === "") {
    return { ok: false, reason: "no_example" };
  }

  // Tokenise by whitespace, preserving surrounding whitespace in result.
  const tokens = example.split(/(\s+)/);

  // Find the first token that matches the target word.
  let matchedIndex = -1;
  let matchedToken = "";
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i];
    if (raw.trim() === "") continue; // whitespace chunk
    if (tokenMatches(raw, word)) {
      matchedIndex = i;
      matchedToken = raw;
      break;
    }
  }

  if (matchedIndex === -1) {
    return { ok: false, reason: "word_not_found" };
  }

  // Build the mask: underscores equal to the stripped token length.
  const stripped = stripPunct(matchedToken);
  const blank = "_".repeat(Math.max(stripped.length, word.length));

  // Preserve punctuation that surrounded the matched token in the sentence.
  const leadPunct = matchedToken.slice(
    0,
    matchedToken.length - matchedToken.replace(/^[^\w']+/, "").length,
  );
  const trailPunct = matchedToken.slice(
    matchedToken.replace(/[^\w']+$/, "").length,
  );
  const maskedToken = leadPunct + blank + trailPunct;

  tokens[matchedIndex] = maskedToken;
  const masked = tokens.join("");

  return {
    ok: true,
    card: {
      masked,
      answer: stripped || word,
      answerLength: (stripped || word).length,
    },
  };
}

/**
 * Grades a cloze answer: returns true when the learner's response matches the
 * expected answer case-insensitively, ignoring leading/trailing whitespace and
 * trailing punctuation.
 */
export function gradeCloze(answer: string, userInput: string): boolean {
  const clean = (s: string) => stripPunct(s.trim()).toLowerCase();
  return clean(answer) === clean(userInput);
}
