/**
 * Oral fluency practice passages (#1304). Pure and deterministic — works with
 * AI disabled.
 *
 * A passage is the first `target` words of the article (100, 150, or 200),
 * starting at the first paragraph and ending exactly at the target count so
 * scoring sheets agree. Lines wrap at about `LINE_WORDS` words and carry the
 * cumulative word count a teacher reads off when the minute ends.
 */

export const FLUENCY_LENGTHS = [100, 150, 200] as const;
export type FluencyLength = (typeof FLUENCY_LENGTHS)[number];

const LINE_WORDS = 12;

export type FluencyLine = { text: string; cumulative: number };

export type FluencyPassage = {
  target: FluencyLength;
  /** Words in the passage; less than `target` for short articles. */
  wordCount: number;
  lines: FluencyLine[];
  /** True when the passage stops mid-sentence at the target count. */
  truncated: boolean;
};

export function isFluencyLength(value: unknown): value is FluencyLength {
  return (FLUENCY_LENGTHS as readonly number[]).includes(Number(value));
}

/** Parses `?words=`; anything else is the 100-word passage. */
export function parseFluencyLength(value: unknown): FluencyLength {
  const raw = Array.isArray(value) ? value[0] : value;
  return isFluencyLength(raw) ? (Number(raw) as FluencyLength) : 100;
}

/** Splits plain reader text into paragraphs of whitespace-separated words. */
function paragraphWords(text: string): string[][] {
  return text
    .split(/\n\s*\n|\n/)
    .map((paragraph) => paragraph.split(/\s+/).filter(Boolean))
    .filter((words) => words.length > 0);
}

/**
 * Extracts a fluency passage of `target` words from the article's plain text.
 * Lines never cross paragraph breaks.
 */
export function extractFluencyPassage(text: string, target: FluencyLength): FluencyPassage {
  const lines: FluencyLine[] = [];
  let count = 0;
  let lastWord = "";
  outer: for (const words of paragraphWords(text)) {
    for (let start = 0; start < words.length; start += LINE_WORDS) {
      const room = target - count;
      if (room <= 0) break outer;
      const slice = words.slice(start, start + Math.min(LINE_WORDS, room));
      count += slice.length;
      lastWord = slice[slice.length - 1] ?? lastWord;
      lines.push({ text: slice.join(" "), cumulative: count });
    }
  }
  return {
    target,
    wordCount: count,
    lines,
    truncated: count === target && !/[.!?]["”’)]?$/.test(lastWord),
  };
}

/** Words correct per minute for a one-minute read. */
export function wordsCorrectPerMinute(wordsRead: number, errors: number, seconds = 60): number {
  if (wordsRead <= 0 || seconds <= 0) return 0;
  return Math.max(0, Math.round(((wordsRead - errors) * 60) / seconds));
}

/** Accuracy percentage (0–100) of a read. */
export function fluencyAccuracy(wordsRead: number, errors: number): number {
  if (wordsRead <= 0) return 0;
  return Math.max(0, Math.round(((wordsRead - errors) / wordsRead) * 100));
}

/** Reading level band for an accuracy percentage. */
export function accuracyBand(accuracy: number): "independent" | "instructional" | "frustration" {
  if (accuracy >= 97) return "independent";
  if (accuracy >= 90) return "instructional";
  return "frustration";
}

/** Accuracy bands and a 4-point prosody scale for the printable rubric. */
export const FLUENCY_RUBRIC = {
  accuracy: [
    { band: "independent", label: "Independent", range: "97–100%" },
    { band: "instructional", label: "Instructional", range: "90–96%" },
    { band: "frustration", label: "Frustration", range: "Below 90%" },
  ],
  prosody: [
    { score: 4, label: "Reads in larger, meaningful phrases with expression; follows punctuation." },
    { score: 3, label: "Reads mostly in three- or four-word phrases; some expression." },
    { score: 2, label: "Reads mostly in two-word phrases; little expression." },
    { score: 1, label: "Reads word by word; monotone." },
  ],
} as const;
