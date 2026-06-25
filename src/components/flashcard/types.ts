/**
 * Shared types for the flashcard SRS session components.
 * Grade is re-exported from the SRS engine to stay in sync.
 */
export type { Grade } from "@/lib/learning/srs";

export type DueCard = {
  id: string;
  word: string;
  explanation: string | null;
  example: string | null;
  contextSentence: string | null;
  articleId: string | null;
  /** Populated only when fetched via /api/study/cloze */
  cloze?: { masked: string; answerLength: number } | null;
};

export type ReviewMode = "flashcard" | "cloze";

export type AppState =
  | { phase: "idle" }
  | { phase: "loading" }
  | {
      phase: "session";
      mode: ReviewMode;
      cards: DueCard[];
      index: number;
      flipped: boolean;
      grading: boolean;
      gradeCounts: Record<string, number>;
      /** Cloze-mode: the user's typed answer */
      clozeInput: string;
      /** Cloze-mode: whether the answer has been submitted (show feedback) */
      clozeSubmitted: boolean;
      /** Cloze-mode: was the answer correct? */
      clozeCorrect: boolean | null;
    }
  | { phase: "complete"; total: number; gradeCounts: Record<string, number> };
