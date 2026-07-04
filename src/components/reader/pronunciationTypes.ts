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
  average: number | null;
  trendDelta: number | null;
  attempts: number;
};

export type SavedNote = "idle" | "saving" | "saved" | "failed";

export type PronunciationAttemptSummary = {
  id?: string;
  referenceText: string;
  articleId?: string | null;
  pronScore: number;
  createdAt: string;
};

export type SentenceTrend = {
  key: string;
  articleId: string | null;
  referenceText: string;
  attempts: number;
  firstScore: number;
  latestScore: number;
  bestScore: number;
  averageScore: number;
  trendDelta: number;
  lastPracticedAt: string;
  scores: number[];
};

export type SpeechTokenResult =
  | { status: "ok"; token: string; region: string }
  | { status: "unconfigured" }
  | { status: "transient"; message?: string };

const GOOD_WORD_SCORE = 80;
const FAIR_WORD_SCORE = 60;

/** Returns the band for a word given its accuracy score and error type. */
export function getWordBand(score: number, errorType: string): WordBand {
  if (errorType === "Omission") return "omitted";
  if (score >= GOOD_WORD_SCORE) return "good";
  if (score >= FAIR_WORD_SCORE) return "fair";
  return "poor";
}
