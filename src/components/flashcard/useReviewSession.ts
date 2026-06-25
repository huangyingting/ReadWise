"use client";

/**
 * useReviewSession — session state hook for the flashcard SRS review loop.
 *
 * Owns phases (idle → loading → session → complete), fetching, current index,
 * grade counts, optimistic grade submission, and due-count updates.
 * Uses a pure reducer (reviewSessionReducer) for all sync state transitions.
 */
import { useReducer, useState, useRef, useEffect, useCallback } from "react";
import type { ReviewMode } from "./types";
import type { Grade } from "@/lib/learning/srs";
import {
  reviewSessionReducer,
  type ReviewAction,
} from "./reviewSessionReducer";

interface UseReviewSessionOptions {
  initialDueCount: number;
  onSessionStart?: () => void;
  onSessionEnd?: () => void;
  announce: (msg: string) => void;
  /** Called after a card flip so the caller can move focus to grade buttons. */
  onAfterFlip?: () => void;
  /**
   * Called after grading advances to the next card so the caller can move
   * focus back to the show-answer / cloze-input control.
   */
  onAfterGradeAdvance?: () => void;
}

export function useReviewSession({
  initialDueCount,
  onSessionStart,
  onSessionEnd,
  announce,
  onAfterFlip,
  onAfterGradeAdvance,
}: UseReviewSessionOptions) {
  const [appState, dispatch] = useReducer(reviewSessionReducer, {
    phase: "idle",
  });
  const [dueCount, setDueCount] = useState(initialDueCount);

  // Always-fresh ref so stable callbacks can read the latest state.
  const appStateRef = useRef(appState);
  useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);

  // Notify parent when session becomes active / inactive.
  const phaseRef = useRef(appState.phase);
  useEffect(() => {
    if (phaseRef.current === appState.phase) return;
    phaseRef.current = appState.phase;
    if (appState.phase === "session") {
      onSessionStart?.();
    } else {
      onSessionEnd?.();
    }
  });

  // ── Actions ──────────────────────────────────────────────────────────────

  const startSession = useCallback(
    async (mode: ReviewMode) => {
      dispatch({ type: "START_LOADING" });
      try {
        const endpoint =
          mode === "cloze" ? "/api/study/cloze" : "/api/study/flashcards";
        const res = await fetch(endpoint);
        if (!res.ok) throw new Error("fetch failed");

        let cards: import("./types").DueCard[];
        let newDueCount: number;

        if (mode === "cloze") {
          const data = (await res.json()) as {
            items: import("./types").DueCard[];
          };
          cards = data.items;
          newDueCount = cards.length;
        } else {
          const data = (await res.json()) as {
            cards: import("./types").DueCard[];
            dueCount: number;
          };
          cards = data.cards;
          newDueCount = data.dueCount;
        }

        setDueCount(newDueCount);
        dispatch({ type: "SESSION_LOADED", mode, cards });
      } catch {
        dispatch({ type: "LOAD_FAILED" });
      }
    },
    [],
  );

  const flipCard = useCallback(() => {
    const s = appStateRef.current;
    if (s.phase !== "session" || s.flipped) return;
    dispatch({ type: "FLIP" });
    announce("Answer revealed");
    setTimeout(() => onAfterFlip?.(), 0);
  }, [announce, onAfterFlip]);

  const setClozeInput = useCallback((input: string) => {
    dispatch({ type: "CLOZE_INPUT", input });
  }, []);

  const submitClozeAnswer = useCallback(
    (input: string) => {
      const s = appStateRef.current;
      if (s.phase !== "session" || s.mode !== "cloze") return;
      const card = s.cards[s.index];
      const correct =
        input.trim().toLowerCase() === card.word.toLowerCase();
      dispatch({ type: "CLOZE_SUBMIT", correct });
      announce(correct ? "Correct!" : "Incorrect.");
      setTimeout(() => onAfterFlip?.(), 0);
    },
    [announce, onAfterFlip],
  );

  const submitGrade = useCallback(
    async (grade: Grade) => {
      const s = appStateRef.current;
      if (s.phase !== "session") return;
      if (s.mode === "flashcard" && (!s.flipped || s.grading)) return;

      const cardId = s.cards[s.index].id;
      const total = s.cards.length;
      const currentIndex = s.index;

      dispatch({ type: "GRADE_OPTIMISTIC" });

      try {
        const res = await fetch("/api/study/flashcards/grade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ savedWordId: cardId, grade }),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            dueAt: string | null;
            dueCount: number;
          };
          setDueCount(data.dueCount);
        }
      } catch {
        // Network error: still advance optimistically
      }

      const nextIndex = currentIndex + 1;
      if (nextIndex >= total) {
        announce("Session complete.");
      } else {
        announce(`Marked ${grade}. Card ${nextIndex + 1} of ${total}.`);
        setTimeout(() => onAfterGradeAdvance?.(), 0);
      }
      dispatch({ type: "GRADE_ADVANCE", grade });
    },
    [announce, onAfterGradeAdvance],
  );

  const endSession = useCallback(() => {
    dispatch({ type: "END_SESSION" });
  }, []);

  return {
    appState,
    appStateRef,
    dueCount,
    startSession,
    flipCard,
    setClozeInput,
    submitClozeAnswer,
    submitGrade,
    endSession,
  };
}
