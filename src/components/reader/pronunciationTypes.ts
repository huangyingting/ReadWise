export type WordBand = "good" | "fair" | "poor" | "omitted";

export type WordResult = {
  word: string;
  score: number;
  errorType: string;
  band: WordBand;
};

export type AssessResult = {
  accuracyScore: number;
  fluencyScore: number;
  completenessScore: number;
  pronScore: number;
  words: WordResult[];
};

export type SentenceHistory = {
  best: number | null;
  last: number | null;
};

export type SavedNote = "idle" | "saving" | "saved" | "failed";

export type PronunciationAttemptSummary = {
  referenceText: string;
  pronScore: number;
  createdAt: string;
};

export type SpeechTokenResult =
  | { status: "ok"; token: string; region: string }
  | { status: "unconfigured" }
  | { status: "transient"; message?: string };

/** Returns the band for a word given its accuracy score and error type. */
export function getWordBand(score: number, errorType: string): WordBand {
  if (errorType === "Omission") return "omitted";
  if (score >= 80) return "good";
  if (score >= 60) return "fair";
  return "poor";
}
