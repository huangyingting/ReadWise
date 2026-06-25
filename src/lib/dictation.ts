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

import {
  type WordTiming,
} from "@/lib/speech-timing";
import { segmentSpeechPractice } from "@/lib/speech-practice";

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
