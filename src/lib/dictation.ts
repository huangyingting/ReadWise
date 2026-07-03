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

import { type WordTiming } from "@/lib/speech/timing";
import { segmentSpeechPractice } from "@/lib/speech/practice";

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

export type SpeechWordTiming = WordTiming;

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

interface TokenizedWords {
  raw: string[];
  normalized: string[];
}

function tokenizeWords(text: string): TokenizedWords {
  const raw = text.split(/\s+/).filter(Boolean);
  return {
    raw,
    normalized: raw.map(normalizeWord).filter(Boolean),
  };
}

function buildEditDistanceTable(refNorm: string[], typNorm: string[]): number[][] {
  const refCount = refNorm.length;
  const typedCount = typNorm.length;
  const dp: number[][] = Array.from({ length: refCount + 1 }, () =>
    new Array<number>(typedCount + 1).fill(0),
  );

  for (let i = 0; i <= refCount; i++) dp[i][0] = i;
  for (let j = 0; j <= typedCount; j++) dp[0][j] = j;

  for (let i = 1; i <= refCount; i++) {
    for (let j = 1; j <= typedCount; j++) {
      if (refNorm[i - 1] === typNorm[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp;
}

function shouldBacktrackAsExtra(dp: number[][], i: number, j: number): boolean {
  return (
    j > 0 &&
    (i === 0 ||
      (dp[i][j - 1] <= dp[i - 1][j] &&
        dp[i][j - 1] <= dp[i - 1][j - 1]))
  );
}

function shouldBacktrackAsWrong(dp: number[][], i: number, j: number): boolean {
  return (
    i > 0 &&
    j > 0 &&
    dp[i - 1][j - 1] <= dp[i - 1][j] &&
    dp[i - 1][j - 1] <= dp[i][j - 1]
  );
}

function buildDiffTokens(
  ref: TokenizedWords,
  typed: TokenizedWords,
  dp: number[][],
): DiffToken[] {
  const tokens: DiffToken[] = [];
  let i = ref.normalized.length;
  let j = typed.normalized.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && ref.normalized[i - 1] === typed.normalized[j - 1]) {
      tokens.push({ word: ref.raw[i - 1], status: "correct" });
      i--;
      j--;
    } else if (shouldBacktrackAsExtra(dp, i, j)) {
      tokens.push({ word: typed.raw[j - 1], status: "extra" });
      j--;
    } else if (shouldBacktrackAsWrong(dp, i, j)) {
      tokens.push({
        word: ref.raw[i - 1],
        status: "wrong",
        typed: typed.raw[j - 1],
      });
      i--;
      j--;
    } else {
      tokens.push({ word: ref.raw[i - 1], status: "missing" });
      i--;
    }
  }

  tokens.reverse();
  return tokens;
}

function accuracyFor(tokens: DiffToken[], referenceWordCount: number): number {
  if (referenceWordCount === 0) return 100;

  const correct = tokens.filter((t) => t.status === "correct").length;
  return Math.round((correct / referenceWordCount) * 100);
}

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
  const ref = tokenizeWords(reference);
  const typedWords = tokenizeWords(typed);
  const referenceWordCount = ref.normalized.length;
  const typedWordCount = typedWords.normalized.length;

  if (referenceWordCount === 0 && typedWordCount === 0) {
    return { tokens: [], accuracy: 100 };
  }

  const dp = buildEditDistanceTable(ref.normalized, typedWords.normalized);
  const tokens = buildDiffTokens(ref, typedWords, dp);
  const accuracy = accuracyFor(tokens, referenceWordCount);

  return { tokens, accuracy };
}

// ─── Sentence segmentation ────────────────────────────────────────────────────

/**
 * Splits plainText into practisable sentence segments, each annotated with
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
  plainText: string,
  words: SpeechWordTiming[],
): DictationSegment[] {
  return segmentSpeechPractice(plainText, words);
}
