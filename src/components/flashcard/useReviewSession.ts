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
} from "./reviewSessionReducer";
import {
  fetchReviewCards,
  isAbortError,
  submitReviewGrade,
} from "./reviewSessionTransport";
import { useDeferredCallbackQueue } from "./useDeferredCallbackQueue";

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
  const scheduleDeferred = useDeferredCallbackQueue();

  const loadControllerRef = useRef<AbortController | null>(null);
  const loadRequestIdRef = useRef(0);
  const gradeControllersRef = useRef<Set<AbortController>>(new Set());

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
  }, [appState.phase, onSessionStart, onSessionEnd]);

  const abortPendingLoad = useCallback(() => {
    loadControllerRef.current?.abort();
    loadControllerRef.current = null;
  }, []);

  const abortPendingGrades = useCallback(() => {
    for (const controller of gradeControllersRef.current) {
      controller.abort();
    }
    gradeControllersRef.current.clear();
  }, []);

  useEffect(() => {
    return () => {
      abortPendingLoad();
      abortPendingGrades();
    };
  }, [abortPendingLoad, abortPendingGrades]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const startSession = useCallback(
    async (mode: ReviewMode) => {
      dispatch({ type: "START_LOADING" });
      abortPendingLoad();
      const controller = new AbortController();
      loadControllerRef.current = controller;
      const requestId = ++loadRequestIdRef.current;

      try {
        const { cards, dueCount: loadedDueCount } = await fetchReviewCards(
          mode,
          controller.signal,
        );
        if (
          controller.signal.aborted ||
          requestId !== loadRequestIdRef.current
        ) return;

        setDueCount(loadedDueCount);
        dispatch({ type: "SESSION_LOADED", mode, cards });
      } catch (error) {
        if (
          controller.signal.aborted ||
          requestId !== loadRequestIdRef.current ||
          isAbortError(error)
        ) return;

        dispatch({ type: "LOAD_FAILED" });
      } finally {
        if (loadControllerRef.current === controller) {
          loadControllerRef.current = null;
        }
      }
    },
    [abortPendingLoad],
  );

  const flipCard = useCallback(() => {
    const s = appStateRef.current;
    if (s.phase !== "session" || s.flipped) return;
    dispatch({ type: "FLIP" });
    announce("Answer revealed");
    scheduleDeferred(onAfterFlip);
  }, [announce, onAfterFlip, scheduleDeferred]);

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
      scheduleDeferred(onAfterFlip);
    },
    [announce, onAfterFlip, scheduleDeferred],
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
      const controller = new AbortController();
      gradeControllersRef.current.add(controller);

      try {
        const data = await submitReviewGrade(cardId, grade, controller.signal);
        if (!controller.signal.aborted && data) {
          setDueCount(data.dueCount);
        }
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) return;
        // Network error: still advance optimistically
      } finally {
        gradeControllersRef.current.delete(controller);
      }

      if (controller.signal.aborted) return;

      const nextIndex = currentIndex + 1;
      if (nextIndex >= total) {
        announce("Session complete.");
      } else {
        announce(`Marked ${grade}. Card ${nextIndex + 1} of ${total}.`);
        scheduleDeferred(onAfterGradeAdvance);
      }
      dispatch({ type: "GRADE_ADVANCE", grade });
    },
    [announce, onAfterGradeAdvance, scheduleDeferred],
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
