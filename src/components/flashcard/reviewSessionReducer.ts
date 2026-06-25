/**
 * Pure reducer for the flashcard review session state machine.
 * Exported as a standalone function so session transitions can be
 * tested without rendering any React components.
 *
 * State machine:
 *   idle → loading → session (flip/grade loop) → complete → idle
 */
import type { AppState, DueCard, ReviewMode } from "./types";
import type { Grade } from "@/lib/learning/srs";

export type ReviewAction =
  | { type: "START_LOADING" }
  | { type: "SESSION_LOADED"; mode: ReviewMode; cards: DueCard[] }
  | { type: "LOAD_FAILED" }
  | { type: "FLIP" }
  | { type: "CLOZE_INPUT"; input: string }
  | { type: "CLOZE_SUBMIT"; correct: boolean }
  | { type: "GRADE_OPTIMISTIC" }
  | { type: "GRADE_ADVANCE"; grade: Grade }
  | { type: "END_SESSION" };

const EMPTY_COUNTS: Record<Grade, number> = {
  again: 0,
  hard: 0,
  good: 0,
  easy: 0,
};

export function reviewSessionReducer(
  state: AppState,
  action: ReviewAction,
): AppState {
  switch (action.type) {
    case "START_LOADING":
      return { phase: "loading" };

    case "SESSION_LOADED":
      if (action.cards.length === 0) return { phase: "idle" };
      return {
        phase: "session",
        mode: action.mode,
        cards: action.cards,
        index: 0,
        flipped: false,
        grading: false,
        gradeCounts: { ...EMPTY_COUNTS },
        clozeInput: "",
        clozeSubmitted: false,
        clozeCorrect: null,
      };

    case "LOAD_FAILED":
      return { phase: "idle" };

    case "FLIP":
      if (state.phase !== "session" || state.flipped) return state;
      return { ...state, flipped: true };

    case "CLOZE_INPUT":
      if (state.phase !== "session") return state;
      return { ...state, clozeInput: action.input };

    case "CLOZE_SUBMIT":
      if (state.phase !== "session") return state;
      return { ...state, clozeSubmitted: true, clozeCorrect: action.correct };

    case "GRADE_OPTIMISTIC":
      if (state.phase !== "session") return state;
      return { ...state, grading: true };

    case "GRADE_ADVANCE": {
      if (state.phase !== "session") return state;
      const nextIndex = state.index + 1;
      const newCounts = {
        ...state.gradeCounts,
        [action.grade]: (state.gradeCounts[action.grade] ?? 0) + 1,
      };
      if (nextIndex >= state.cards.length) {
        return {
          phase: "complete",
          total: state.cards.length,
          gradeCounts: newCounts,
        };
      }
      return {
        ...state,
        index: nextIndex,
        flipped: false,
        grading: false,
        gradeCounts: newCounts,
        clozeInput: "",
        clozeSubmitted: false,
        clozeCorrect: null,
      };
    }

    case "END_SESSION":
      return { phase: "idle" };

    default:
      return state;
  }
}
