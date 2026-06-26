"use client";

import { useRef, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/Card";
import { useReviewSession } from "@/components/flashcard/useReviewSession";
import { useSpeechSynthesisWord } from "@/components/flashcard/useSpeechSynthesisWord";
import { ReviewStartCard } from "@/components/flashcard/ReviewStartCard";
import { ReviewProgress } from "@/components/flashcard/ReviewProgress";
import { ReviewComplete } from "@/components/flashcard/ReviewComplete";
import { FlashcardFace } from "@/components/flashcard/FlashcardFace";
import { ClozeCard } from "@/components/flashcard/ClozeCard";
import type { Grade } from "@/components/flashcard/types";

interface FlashcardReviewProps {
  /** Due count from SSR — avoids an extra fetch on mount. */
  initialDueCount: number;
  /** Called when a review session becomes active (phase → "session"). */
  onSessionStart?: () => void;
  /** Called when a review session ends (phase → idle or complete). */
  onSessionEnd?: () => void;
}

/**
 * Flashcard review session (SRS). Client component.
 *
 * States: idle → loading → session (flip/grade loop) → complete → idle.
 * Modes: "flashcard" (classic flip) | "cloze" (fill-in-the-blank).
 * Fetches cards from GET /api/study/flashcards (flashcard mode) or
 * GET /api/study/cloze (cloze mode).
 * Grades via POST /api/study/flashcards/grade (optimistic advance).
 * Audio via browser SpeechSynthesis (no server call needed).
 *
 * Keyboard map:
 *   Space/Enter (front) = flip / submit cloze; 1=Again, 2=Hard, 3=Good, 4=Easy; Esc=end.
 */
export default function FlashcardReview({
  initialDueCount,
  onSessionStart,
  onSessionEnd,
}: FlashcardReviewProps) {
  // ── DOM refs ──────────────────────────────────────────────────────────────
  const liveRef = useRef<HTMLDivElement>(null);
  const sessionRegionRef = useRef<HTMLDivElement>(null);
  const showAnswerRef = useRef<HTMLButtonElement>(null);
  const goodButtonRef = useRef<HTMLButtonElement>(null);
  const clozeInputRef = useRef<HTMLInputElement>(null);

  /** Politely announce to screen readers. */
  const announce = useCallback((msg: string) => {
    if (liveRef.current) {
      liveRef.current.textContent = "";
      requestAnimationFrame(() => {
        if (liveRef.current) liveRef.current.textContent = msg;
      });
    }
  }, []);

  // ── Session state hook ────────────────────────────────────────────────────
  const {
    appState,
    appStateRef,
    dueCount,
    startSession,
    flipCard,
    setClozeInput,
    submitClozeAnswer,
    submitGrade,
    endSession,
  } = useReviewSession({
    initialDueCount,
    onSessionStart,
    onSessionEnd,
    announce,
    onAfterFlip: () => goodButtonRef.current?.focus(),
    onAfterGradeAdvance: () => {
      // clozeInputRef takes priority (cloze mode), else showAnswerRef (flashcard)
      clozeInputRef.current?.focus();
      showAnswerRef.current?.focus();
    },
  });

  // ── Speech synthesis hook ─────────────────────────────────────────────────
  const { speechAvailable, speaking, speak } = useSpeechSynthesisWord();

  // ── Focus management: move into session panel when session first starts ────
  const sessionStartedRef = useRef(false);
  // Extract card count for the dep array — appState.cards only exists in session phase.
  const cardCount = appState.phase === "session" ? appState.cards.length : undefined;
  useEffect(() => {
    if (appState.phase === "session") {
      if (sessionStartedRef.current) return;
      sessionStartedRef.current = true;
      announce(`Review started. Card 1 of ${appState.cards.length}.`);
      setTimeout(() => {
        const target =
          clozeInputRef.current ??
          showAnswerRef.current ??
          sessionRegionRef.current;
        target?.focus();
      }, 0);
    } else {
      sessionStartedRef.current = false;
    }
  }, [appState.phase, cardCount, announce]);

  // ── Global keyboard handler ───────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const s = appStateRef.current;
      if (s.phase !== "session") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "Escape") {
        e.preventDefault();
        endSession();
        return;
      }

      const gradeMap: Record<string, Grade> = {
        "1": "again",
        "2": "hard",
        "3": "good",
        "4": "easy",
      };

      if (s.mode === "flashcard") {
        if (!s.flipped) {
          if (e.key === " " || e.key === "Enter") {
            const tag = (document.activeElement as HTMLElement)?.tagName;
            if (tag !== "BUTTON") {
              e.preventDefault();
              flipCard();
            }
          }
        } else {
          const g = gradeMap[e.key];
          if (g) {
            e.preventDefault();
            void submitGrade(g);
          }
        }
      } else {
        // Cloze mode: number keys grade after answer is revealed
        if (s.clozeSubmitted) {
          const g = gradeMap[e.key];
          if (g) {
            e.preventDefault();
            void submitGrade(g);
          }
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [appStateRef, flipCard, submitGrade, endSession]);

  // ── Render ────────────────────────────────────────────────────────────────

  const s = appState;

  return (
    <>
      {/* SR live region for announcements */}
      <div
        ref={liveRef}
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />

      {s.phase === "idle" && (
        <ReviewStartCard
          dueCount={dueCount}
          onStartFlashcard={() => void startSession("flashcard")}
          onStartCloze={() => void startSession("cloze")}
        />
      )}

      {s.phase === "loading" && (
        <Card>
          <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text m-0">
            Flashcard review
          </h2>
          <p
            className="text-[length:var(--text-sm)] text-text-muted m-0"
            style={{ marginTop: "var(--space-2)" }}
          >
            Loading cards…
          </p>
        </Card>
      )}

      {s.phase === "session" && (
        <Card>
          <ReviewProgress
            index={s.index}
            total={s.cards.length}
            mode={s.mode}
            sessionRegionRef={sessionRegionRef}
            onEndSession={endSession}
          />

          {s.mode === "cloze" ? (
            <ClozeCard
              card={s.cards[s.index]}
              clozeInput={s.clozeInput}
              clozeSubmitted={s.clozeSubmitted}
              clozeCorrect={s.clozeCorrect}
              flipped={s.flipped}
              grading={s.grading}
              speechAvailable={speechAvailable}
              speaking={speaking}
              showAnswerRef={showAnswerRef}
              goodButtonRef={goodButtonRef}
              clozeInputRef={clozeInputRef}
              onClozeInput={setClozeInput}
              onSubmitCloze={submitClozeAnswer}
              onFlip={flipCard}
              onSpeak={speak}
              onGrade={(g) => void submitGrade(g)}
            />
          ) : (
            <FlashcardFace
              card={s.cards[s.index]}
              flipped={s.flipped}
              grading={s.grading}
              speechAvailable={speechAvailable}
              speaking={speaking}
              showAnswerRef={showAnswerRef}
              goodButtonRef={goodButtonRef}
              onFlip={flipCard}
              onSpeak={speak}
              onGrade={(g) => void submitGrade(g)}
            />
          )}
        </Card>
      )}

      {s.phase === "complete" && (
        <Card>
          <ReviewComplete
            total={s.total}
            gradeCounts={s.gradeCounts}
            dueCount={dueCount}
            onDone={endSession}
            onReviewAgain={() => void startSession("flashcard")}
          />
        </Card>
      )}
    </>
  );
}
