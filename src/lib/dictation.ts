/**
 * Dictation exercise utilities (Issue #40).
 *
 * Pure functions with no browser or DB dependencies — fully unit-testable.
 *
 * Public API:
 *   normalizeWord(w)          — strips leading/trailing punctuation, lowercases.
 *   gradeDictation(ref, typed) — word-level diff + accuracy %.
 *   segmentDictation(text, words) — sentence segmentation with audio timing ranges.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type WordStatus = "correct" | "wrong" | "missing" | "extra";

export interface DiffToken {
  /** The word text to display. For "wrong", this is the REFERENCE word. */
  word: string;
  status: WordStatus;
  /** For "wrong" tokens — what the learner actually typed. */
  typed?: string;
}

export interface DictationGrade {
  /** Per-word diff tokens (reference-anchored). */
  tokens: DiffToken[];
  /** 0–100 — (correct tokens / reference word count) × 100, rounded. */
  accuracy: number;
}

export interface SpeechWordTiming {
  textOffset: number;
  length: number;
  start: number; // seconds
  end: number;   // seconds
}

export interface DictationSegment {
  text: string;
  startTime: number; // seconds
  endTime: number;   // seconds
}

// ─── Word normalization ───────────────────────────────────────────────────────

/** Lowercase + strip leading/trailing non-word characters (punctuation). */
export function normalizeWord(w: string): string {
  return w.toLowerCase().replace(/^[^\w]+|[^\w]+$/g, "");
}

// ─── Grading ─────────────────────────────────────────────────────────────────

/**
 * Computes a word-level diff between a reference string and the learner's
 * typed string. Case and punctuation are ignored in comparisons.
 *
 * Uses a standard edit-distance DP with backtracking:
 *   equal (same normalized form) → "correct"
 *   substitution                 → "wrong"  (show ref word + typed word)
 *   deletion (ref word missing)  → "missing"
 *   insertion (extra typed word) → "extra"
 *
 * Accuracy = correct_words / max(1, reference_word_count) × 100.
 */
export function gradeDictation(
  reference: string,
  typed: string,
): DictationGrade {
  const refRaw = reference.split(/\s+/).filter(Boolean);
  const typRaw = typed.split(/\s+/).filter(Boolean);

  const refNorm = refRaw.map(normalizeWord).filter(Boolean);
  const typNorm = typRaw.map(normalizeWord).filter(Boolean);

  const R = refNorm.length;
  const T = typNorm.length;

  if (R === 0 && T === 0) {
    return { tokens: [], accuracy: 100 };
  }

  // DP table: dp[i][j] = edit distance between ref[0..i) and typ[0..j)
  const dp: number[][] = Array.from({ length: R + 1 }, () =>
    new Array<number>(T + 1).fill(0),
  );
  for (let i = 0; i <= R; i++) dp[i][0] = i;
  for (let j = 0; j <= T; j++) dp[0][j] = j;

  for (let i = 1; i <= R; i++) {
    for (let j = 1; j <= T; j++) {
      if (refNorm[i - 1] === typNorm[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build the alignment
  const tokens: DiffToken[] = [];
  let i = R;
  let j = T;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && refNorm[i - 1] === typNorm[j - 1]) {
      // Equal
      tokens.push({ word: refRaw[i - 1], status: "correct" });
      i--;
      j--;
    } else if (
      j > 0 &&
      (i === 0 || dp[i][j - 1] <= dp[i - 1][j] && dp[i][j - 1] <= dp[i - 1][j - 1])
    ) {
      // Insertion (extra typed word)
      tokens.push({ word: typRaw[j - 1], status: "extra" });
      j--;
    } else if (
      i > 0 && j > 0 &&
      dp[i - 1][j - 1] <= dp[i - 1][j] &&
      dp[i - 1][j - 1] <= dp[i][j - 1]
    ) {
      // Substitution (wrong word)
      tokens.push({
        word: refRaw[i - 1],
        status: "wrong",
        typed: typRaw[j - 1],
      });
      i--;
      j--;
    } else {
      // Deletion (missing reference word)
      tokens.push({ word: refRaw[i - 1], status: "missing" });
      i--;
    }
  }

  tokens.reverse();

  const correct = tokens.filter((t) => t.status === "correct").length;
  const accuracy =
    R === 0 ? 100 : Math.round((correct / R) * 100);

  return { tokens, accuracy };
}

// ─── Sentence segmentation ────────────────────────────────────────────────────

const MIN_WORDS = 3;
const MAX_CHARS = 300;

/**
 * Splits spokenText into practisable sentence segments, each annotated with
 * the audio start/end time derived from word-boundary timings.
 *
 * Only sentences that have matching word timings are returned (sentences
 * without any timing data — e.g. because narration was truncated — are
 * silently dropped).
 *
 * The sentence-splitting logic mirrors ArticlePronunciation's `splitSentences`
 * so both tools produce the same segmentation from the same input.
 */
export function segmentDictation(
  spokenText: string,
  words: SpeechWordTiming[],
): DictationSegment[] {
  const sentences = splitSentences(spokenText);
  const segments: DictationSegment[] = [];

  for (const sentence of sentences) {
    const range = findSentenceRange(sentence, spokenText, words);
    if (range) {
      segments.push({ text: sentence, startTime: range.startTime, endTime: range.endTime });
    }
  }

  return segments;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function splitSentences(plainText: string): string[] {
  const results: string[] = [];
  const paragraphs = plainText.split(/\n{2,}/);

  for (const para of paragraphs) {
    const p = para.replace(/\s+/g, " ").trim();
    if (!p) continue;

    let cursor = 0;
    const re = /[.!?]+\s+(?=[A-Z"'"'])/g;
    let m: RegExpExecArray | null;

    while ((m = re.exec(p)) !== null) {
      const punctLen = (m[0].match(/^[.!?]+/) ?? [""])[0].length;
      const segEnd = m.index + punctLen;
      const raw = p.slice(cursor, segEnd);

      const segWords = raw.trim().split(/\s+/).filter(Boolean);
      const lastWord = segWords.at(-1)?.replace(/[.!?]+$/, "") ?? "";
      const isAbbrev = lastWord.length <= 2 && /^[A-Z]/.test(lastWord);
      const isDecimal = /\d$/.test(raw.trimEnd().slice(0, -1) || "");

      if (!isAbbrev && !isDecimal) {
        const trimmed = raw.trim();
        const wc = trimmed.split(/\s+/).filter(Boolean).length;
        if (wc >= MIN_WORDS && trimmed.length <= MAX_CHARS) {
          results.push(trimmed);
        }
        cursor = m.index + m[0].length;
      }
    }

    const remaining = p.slice(cursor).trim();
    if (remaining) {
      const wc = remaining.split(/\s+/).filter(Boolean).length;
      if (wc >= MIN_WORDS && remaining.length <= MAX_CHARS) {
        results.push(remaining);
      }
    }
  }

  return results;
}

function findSentenceRange(
  sentence: string,
  plainText: string,
  words: SpeechWordTiming[],
): { startTime: number; endTime: number } | null {
  if (words.length === 0 || !sentence) return null;

  const needle = sentence.slice(0, Math.min(30, sentence.length));
  const sentStart = plainText.indexOf(needle);
  if (sentStart === -1) return null;

  const sentEnd = sentStart + sentence.length;
  const matching = words.filter(
    (w) => w.textOffset >= sentStart && w.textOffset < sentEnd,
  );
  if (matching.length === 0) return null;

  return {
    startTime: matching[0].start,
    endTime: matching[matching.length - 1].end,
  };
}
