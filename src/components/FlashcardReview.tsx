"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Layers,
  RotateCcw,
  Frown,
  Check,
  ChevronsRight,
  CircleCheck,
  CheckCircle2,
  Volume2,
  FileQuestion,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import EmptyState from "@/components/EmptyState";
import { cn, focusRing } from "@/lib/cn";

type Grade = "again" | "hard" | "good" | "easy";

type DueCard = {
  id: string;
  word: string;
  explanation: string | null;
  example: string | null;
  contextSentence: string | null;
  articleId: string | null;
  /** Populated only when fetched via /api/study/cloze */
  cloze?: { masked: string; answerLength: number } | null;
};

type ReviewMode = "flashcard" | "cloze";

type AppState =
  | { phase: "idle" }
  | { phase: "loading" }
  | {
      phase: "session";
      mode: ReviewMode;
      cards: DueCard[];
      index: number;
      flipped: boolean;
      grading: boolean;
      gradeCounts: Record<Grade, number>;
      /** Cloze-mode: the user's typed answer */
      clozeInput: string;
      /** Cloze-mode: whether the answer has been submitted (show feedback) */
      clozeSubmitted: boolean;
      /** Cloze-mode: was the answer correct? */
      clozeCorrect: boolean | null;
    }
  | { phase: "complete"; total: number; gradeCounts: Record<Grade, number> };

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
  const [appState, setAppState] = useState<AppState>({ phase: "idle" });
  const [dueCount, setDueCount] = useState(initialDueCount);
  const [speechAvailable, setSpeechAvailable] = useState(false);
  const [speaking, setSpeaking] = useState<string | null>(null);

  useEffect(() => {
    setSpeechAvailable("speechSynthesis" in window);
  }, []);

  // Always-fresh state ref for stable callbacks
  const appStateRef = useRef<AppState>(appState);
  useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);

  // Notify parent when session becomes active / inactive.
  useEffect(() => {
    if (appState.phase === "session") {
      onSessionStart?.();
    } else {
      onSessionEnd?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appState.phase]);

  // DOM refs
  const liveRef = useRef<HTMLDivElement>(null);
  const showAnswerRef = useRef<HTMLButtonElement>(null);
  const goodButtonRef = useRef<HTMLButtonElement>(null);
  const clozeInputRef = useRef<HTMLInputElement>(null);

  /** Politely announce to screen readers. */
  function announce(msg: string) {
    if (liveRef.current) {
      liveRef.current.textContent = "";
      requestAnimationFrame(() => {
        if (liveRef.current) liveRef.current.textContent = msg;
      });
    }
  }

  /** Speak a word using the browser's SpeechSynthesis. */
  const speak = useCallback(
    (word: string, cardId: string) => {
      if (!("speechSynthesis" in window)) return;
      if (speaking === cardId) {
        window.speechSynthesis.cancel();
        setSpeaking(null);
        return;
      }
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(word);
      utt.onend = () => setSpeaking(null);
      utt.onerror = () => setSpeaking(null);
      setSpeaking(cardId);
      window.speechSynthesis.speak(utt);
    },
    [speaking],
  );

  async function startSession(mode: ReviewMode) {
    setAppState({ phase: "loading" });
    try {
      const endpoint =
        mode === "cloze" ? "/api/study/cloze" : "/api/study/flashcards";
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error("fetch failed");

      let cards: DueCard[];
      let newDueCount: number;

      if (mode === "cloze") {
        const data = (await res.json()) as { items: DueCard[] };
        cards = data.items;
        newDueCount = cards.length;
      } else {
        const data = (await res.json()) as { cards: DueCard[]; dueCount: number };
        cards = data.cards;
        newDueCount = data.dueCount;
      }

      setDueCount(newDueCount);
      if (cards.length === 0) {
        setAppState({ phase: "idle" });
        return;
      }
      setAppState({
        phase: "session",
        mode,
        cards,
        index: 0,
        flipped: false,
        grading: false,
        gradeCounts: { again: 0, hard: 0, good: 0, easy: 0 },
        clozeInput: "",
        clozeSubmitted: false,
        clozeCorrect: null,
      });
    } catch {
      setAppState({ phase: "idle" });
    }
  }

  const flipCard = useCallback(() => {
    const s = appStateRef.current;
    if (s.phase !== "session" || s.flipped) return;
    setAppState((prev) =>
      prev.phase === "session" ? { ...prev, flipped: true } : prev,
    );
    announce("Answer revealed");
    setTimeout(() => goodButtonRef.current?.focus(), 0);
  }, []);

  /** Grades a cloze answer client-side and records it with the SRS. */
  const submitClozeAnswer = useCallback((input: string) => {
    const s = appStateRef.current;
    if (s.phase !== "session" || s.mode !== "cloze") return;
    const card = s.cards[s.index];
    // Determine correct answer from the API response or fall back to the word
    const correct = (() => {
      const clozeAnswer = card.word;
      return input.trim().toLowerCase() === clozeAnswer.toLowerCase();
    })();
    setAppState((prev) =>
      prev.phase === "session"
        ? { ...prev, clozeSubmitted: true, clozeCorrect: correct }
        : prev,
    );
    announce(correct ? "Correct!" : "Incorrect.");
  }, []);

  const submitGrade = useCallback(
    async (g: Grade) => {
      const s = appStateRef.current;
      if (s.phase !== "session") return;
      if (s.mode === "flashcard" && (!s.flipped || s.grading)) return;

      const cardId = s.cards[s.index].id;
      const total = s.cards.length;
      const currentIndex = s.index;

      setAppState((prev) =>
        prev.phase === "session" ? { ...prev, grading: true } : prev,
      );

      try {
        const res = await fetch("/api/study/flashcards/grade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ savedWordId: cardId, grade: g }),
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
        setAppState((prev) => {
          if (prev.phase !== "session") return prev;
          return {
            phase: "complete",
            total,
            gradeCounts: { ...prev.gradeCounts, [g]: prev.gradeCounts[g] + 1 },
          };
        });
      } else {
        announce(`Marked ${g}. Card ${nextIndex + 1} of ${total}.`);
        setAppState((prev) => {
          if (prev.phase !== "session") return prev;
          return {
            ...prev,
            index: nextIndex,
            flipped: false,
            grading: false,
            gradeCounts: { ...prev.gradeCounts, [g]: prev.gradeCounts[g] + 1 },
            clozeInput: "",
            clozeSubmitted: false,
            clozeCorrect: null,
          };
        });
        setTimeout(() => {
          showAnswerRef.current?.focus();
          clozeInputRef.current?.focus();
        }, 0);
      }
    },
    [],
  );

  /** Global keyboard handler — bound once, reads from appStateRef. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const s = appStateRef.current;
      if (s.phase !== "session") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "Escape") {
        e.preventDefault();
        setAppState({ phase: "idle" });
        return;
      }

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
          const gradeMap: Record<string, Grade> = {
            "1": "again",
            "2": "hard",
            "3": "good",
            "4": "easy",
          };
          const g = gradeMap[e.key];
          if (g) {
            e.preventDefault();
            void submitGrade(g);
          }
        }
      } else {
        // Cloze mode: number keys to grade after submission
        if (s.clozeSubmitted) {
          const gradeMap: Record<string, Grade> = {
            "1": "again",
            "2": "hard",
            "3": "good",
            "4": "easy",
          };
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
  }, [flipCard, submitGrade]);

  // ── Render ─────────────────────────────────────────────────────────────

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
        <Card>
          <div className="flex items-start justify-between gap-[var(--space-4)]">
            <div>
              <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text m-0">
                Flashcard review
              </h2>
              <p
                className="text-[length:var(--text-sm)] text-text-muted m-0"
                style={{ marginTop: "var(--space-1)" }}
              >
                {dueCount === 0
                  ? "You're all caught up."
                  : `${dueCount} card${dueCount === 1 ? "" : "s"} due for review`}
              </p>
            </div>
          </div>

          <div style={{ marginTop: "var(--space-5)" }}>
            {dueCount === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="All caught up"
                description="No cards are due for review right now. Save more words while reading, or check back later."
                action={{ label: "Browse articles", href: "/browse" }}
              />
            ) : (
              <div className="flex flex-wrap items-center gap-[var(--space-3)]">
                <Button
                  variant="primary"
                  leadingIcon={<Layers size={16} aria-hidden />}
                  onClick={() => void startSession("flashcard")}
                >
                  Review {dueCount} due
                </Button>
                <Button
                  variant="outline"
                  leadingIcon={<FileQuestion size={16} aria-hidden />}
                  onClick={() => void startSession("cloze")}
                >
                  Cloze review
                </Button>
              </div>
            )}
          </div>
        </Card>
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

      {s.phase === "session" && (() => {
        const card = s.cards[s.index];
        return (
          <Card>
            {/* Session header */}
            <div className="flex items-center justify-between gap-[var(--space-4)]">
              <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text m-0">
                {s.mode === "cloze" ? "Cloze review" : "Reviewing"}
              </h2>
              <div className="flex items-center gap-[var(--space-3)]">
                <span className="text-[length:var(--text-sm)] text-text-muted">
                  {s.index + 1} of {s.cards.length}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAppState({ phase: "idle" })}
                >
                  End session
                </Button>
              </div>
            </div>

            {/* Session progress bar */}
            <div style={{ marginTop: "var(--space-3)" }}>
              <div
                role="progressbar"
                aria-valuenow={s.index}
                aria-valuemin={0}
                aria-valuemax={s.cards.length}
                aria-label="Review session progress"
                className="w-full h-1 rounded-full bg-border overflow-hidden"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-[var(--duration-base)]"
                  style={{ width: `${(s.index / s.cards.length) * 100}%` }}
                />
              </div>
            </div>

            {s.mode === "cloze" ? (
              // ── Cloze card ────────────────────────────────────────────
              <div
                className="flex flex-col items-center justify-center text-center gap-[var(--space-4)] p-[var(--space-4)]"
                style={{ marginTop: "var(--space-5)", minHeight: "220px" }}
              >
                {/* Hint: which word */}
                <p className="text-[length:var(--text-sm)] text-text-muted m-0">
                  Fill in the blank:
                </p>

                {/* Masked sentence or fallback */}
                {card.cloze ? (
                  <p
                    className="font-[family-name:var(--font-reading)] text-[length:var(--text-lg)] text-text m-0"
                    style={{ maxWidth: "52ch" }}
                  >
                    {card.cloze.masked}
                  </p>
                ) : (
                  <>
                    {/* No cloze available — definition fallback */}
                    <p className="font-[family-name:var(--font-display)] text-[length:var(--text-3xl)] font-semibold text-text m-0">
                      {card.word}
                    </p>
                    <p className="text-[length:var(--text-sm)] text-text-muted m-0 italic">
                      (No example available — definition mode)
                    </p>
                  </>
                )}

                {/* Audio button */}
                {speechAvailable && (
                  <button
                    type="button"
                    onClick={() => speak(card.word, card.id)}
                    aria-label={`Play pronunciation of ${card.word}`}
                    className={cn(
                      "inline-flex items-center gap-[var(--space-1)] text-text-muted hover:text-text",
                      "min-h-[44px] px-[var(--space-2)]",
                      "text-[length:var(--text-sm)] transition-colors",
                      focusRing,
                    )}
                  >
                    <Volume2 size={16} aria-hidden />
                    {speaking === card.id ? "Playing…" : card.word}
                  </button>
                )}

                {/* Input / feedback area */}
                {card.cloze && !s.clozeSubmitted && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      submitClozeAnswer(s.clozeInput);
                    }}
                    className="flex flex-col items-center gap-[var(--space-3)] w-full"
                    style={{ maxWidth: "32ch" }}
                  >
                    <input
                      ref={clozeInputRef}
                      type="text"
                      value={s.clozeInput}
                      onChange={(e) =>
                        setAppState((prev) =>
                          prev.phase === "session"
                            ? { ...prev, clozeInput: e.target.value }
                            : prev,
                        )
                      }
                      placeholder={`${"_".repeat(card.cloze.answerLength)}`}
                      autoComplete="off"
                      spellCheck={false}
                      autoFocus
                      className={cn(
                        "w-full rounded-[var(--radius-md)] border border-border-strong bg-surface",
                        "px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-base)] text-text",
                        "placeholder:text-text-subtle text-center",
                        focusRing,
                      )}
                      aria-label="Your answer"
                    />
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={s.clozeInput.trim() === ""}
                    >
                      Check
                    </Button>
                  </form>
                )}

                {/* Feedback after submission */}
                {s.clozeSubmitted && (
                  <div className="flex flex-col items-center gap-[var(--space-3)]">
                    <p
                      className={cn(
                        "font-semibold text-[length:var(--text-base)] m-0",
                        s.clozeCorrect
                          ? "text-[color:var(--success-text)]"
                          : "text-[color:var(--danger-text)]",
                      )}
                    >
                      {s.clozeCorrect ? "✓ Correct!" : `✗ The answer was: ${card.word}`}
                    </p>
                    {card.explanation && (
                      <p className="text-[length:var(--text-sm)] text-text-muted m-0" style={{ maxWidth: "52ch" }}>
                        {card.explanation}
                      </p>
                    )}
                    <GradeButtons onGrade={(g) => void submitGrade(g)} disabled={s.grading} goodRef={goodButtonRef} />
                  </div>
                )}

                {/* Definition-fallback grade buttons (no cloze available) */}
                {!card.cloze && (
                  <div className="flex flex-col items-center gap-[var(--space-3)] w-full">
                    {!s.flipped ? (
                      <button
                        ref={showAnswerRef}
                        type="button"
                        onClick={flipCard}
                        aria-expanded={s.flipped}
                        className={cn(
                          "inline-flex items-center justify-center gap-[var(--space-2)]",
                          "h-10 px-[var(--space-4)]",
                          "rounded-[var(--radius-md)] font-semibold text-[length:var(--text-base)]",
                          "bg-surface text-text border border-border-strong shadow-[var(--shadow-sm)]",
                          "hover:bg-bg-subtle",
                          "transition-[background-color,border-color,box-shadow,transform] [transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-standard)]",
                          "active:translate-y-px active:shadow-none",
                          focusRing,
                        )}
                      >
                        Show definition
                      </button>
                    ) : (
                      <>
                        {card.explanation && (
                          <p className="text-[length:var(--text-base)] text-text m-0" style={{ maxWidth: "52ch" }}>
                            {card.explanation}
                          </p>
                        )}
                        <GradeButtons onGrade={(g) => void submitGrade(g)} disabled={s.grading} goodRef={goodButtonRef} />
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : (
              // ── Classic flashcard ─────────────────────────────────────
              <div
                className="rw-flip"
                style={{ marginTop: "var(--space-5)", minHeight: "220px" }}
              >
                <div
                  className="rw-flip-inner"
                  data-flipped={s.flipped ? "true" : "false"}
                  style={{ minHeight: "220px" }}
                >
                  {/* Front face */}
                  <div
                    className={cn(
                      "rw-flip-face",
                      "flex flex-col items-center justify-center text-center gap-[var(--space-4)] p-[var(--space-4)]",
                      s.flipped ? "opacity-0" : "opacity-100",
                    )}
                  >
                    <p
                      className="font-[family-name:var(--font-display)] text-[length:var(--text-3xl)] font-semibold text-text m-0"
                      style={{ maxWidth: "52ch" }}
                    >
                      {card.word}
                    </p>

                    {/* Audio button */}
                    {speechAvailable && (
                      <button
                        type="button"
                        onClick={() => speak(card.word, card.id)}
                        aria-label={`Play pronunciation of ${card.word}`}
                        className={cn(
                          "inline-flex items-center gap-[var(--space-1)] text-text-muted hover:text-text",
                          "min-h-[44px] px-[var(--space-2)]",
                          "text-[length:var(--text-sm)] transition-colors",
                          focusRing,
                        )}
                      >
                        <Volume2 size={16} aria-hidden />
                        {speaking === card.id ? "Playing…" : "Pronounce"}
                      </button>
                    )}

                    <p className="text-[length:var(--text-sm)] text-text-subtle m-0">
                      Tap or press{" "}
                      <kbd className="font-[family-name:var(--font-sans)] bg-bg-subtle border border-border rounded-[var(--radius-sm)] px-1 text-[length:var(--text-xs)]">
                        Space
                      </kbd>{" "}
                      to reveal
                    </p>
                    <button
                      ref={showAnswerRef}
                      type="button"
                      onClick={flipCard}
                      aria-expanded={s.flipped}
                      className={cn(
                        "inline-flex items-center justify-center gap-[var(--space-2)]",
                        "h-10 px-[var(--space-4)]",
                        "rounded-[var(--radius-md)] font-semibold text-[length:var(--text-base)]",
                        "bg-surface text-text border border-border-strong shadow-[var(--shadow-sm)]",
                        "hover:bg-bg-subtle",
                        "transition-[background-color,border-color,box-shadow,transform] [transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-standard)]",
                        "active:translate-y-px active:shadow-none",
                        "disabled:opacity-50 disabled:cursor-not-allowed",
                        focusRing,
                      )}
                    >
                      Show answer
                    </button>
                  </div>

                  {/* Back face */}
                  <div
                    className={cn(
                      "rw-flip-face rw-flip-back",
                      "flex flex-col items-center justify-center text-center gap-[var(--space-4)] p-[var(--space-4)]",
                      s.flipped ? "opacity-100" : "opacity-0",
                    )}
                  >
                    {/* Word repeated smaller */}
                    <p className="font-[family-name:var(--font-display)] text-[length:var(--text-xl)] font-semibold text-text-muted m-0">
                      {card.word}
                    </p>

                    {/* Audio button on back face */}
                    {speechAvailable && s.flipped && (
                      <button
                        type="button"
                        onClick={() => speak(card.word, card.id)}
                        aria-label={`Play pronunciation of ${card.word}`}
                        className={cn(
                          "inline-flex items-center gap-[var(--space-1)] text-text-muted hover:text-text",
                          "min-h-[44px] px-[var(--space-2)]",
                          "text-[length:var(--text-sm)] transition-colors",
                          focusRing,
                        )}
                      >
                        <Volume2 size={16} aria-hidden />
                        {speaking === card.id ? "Playing…" : "Pronounce"}
                      </button>
                    )}

                    {/* Explanation */}
                    {card.explanation ? (
                      <p
                        className="text-[length:var(--text-base)] text-text m-0"
                        style={{ maxWidth: "52ch" }}
                      >
                        {card.explanation}
                      </p>
                    ) : null}

                    {/* Context sentence (original article sentence) or AI example fallback */}
                    {card.contextSentence ? (
                      <div
                        className="flex flex-col gap-[var(--space-1)]"
                        style={{ maxWidth: "52ch" }}
                      >
                        <p className="text-[length:var(--text-xs)] text-text-muted m-0 uppercase tracking-wide font-semibold">
                          Original context
                        </p>
                        <p className="font-[family-name:var(--font-reading)] italic text-[length:var(--text-base)] text-text-muted m-0">
                          &ldquo;{card.contextSentence}&rdquo;
                        </p>
                      </div>
                    ) : card.example ? (
                      <p
                        className="font-[family-name:var(--font-reading)] italic text-[length:var(--text-base)] text-text-muted m-0"
                        style={{ maxWidth: "52ch" }}
                      >
                        &ldquo;{card.example}&rdquo;
                      </p>
                    ) : null}

                    {/* Article linkback */}
                    {card.articleId ? (
                      <a
                        href={`/reader/${card.articleId}`}
                        className="inline-flex items-center gap-[var(--space-1)] text-[length:var(--text-sm)] text-text-muted hover:text-primary underline underline-offset-2 transition-colors"
                        aria-label={`Go to article where "${card.word}" was saved`}
                      >
                        Go to article ↗
                      </a>
                    ) : null}

                    {/* Grade buttons row */}
                    <GradeButtons onGrade={(g) => void submitGrade(g)} disabled={s.grading} goodRef={goodButtonRef} />
                  </div>
                </div>
              </div>
            )}
          </Card>
        );
      })()}

      {s.phase === "complete" && (
        <Card>
          <div className="flex flex-col items-center text-center gap-[var(--space-4)] py-[var(--space-6)]">
            {/* Success icon chip */}
            <div
              className="inline-flex items-center justify-center h-14 w-14 rounded-full rw-pop"
              style={{
                background: "color-mix(in srgb, var(--success) 12%, transparent)",
                color: "var(--success-text)",
              }}
            >
              <CircleCheck size={40} aria-hidden />
            </div>

            <div>
              <p className="font-[family-name:var(--font-display)] text-[length:var(--text-lg)] text-text m-0">
                Session complete
              </p>
              <p className="text-[length:var(--text-sm)] text-text-muted m-0" style={{ marginTop: "var(--space-1)" }}>
                Reviewed {s.total} card{s.total === 1 ? "" : "s"}.
                {" "}
                {s.gradeCounts.again > 0
                  ? `${s.gradeCounts.again} to review again · `
                  : ""}
                {s.gradeCounts.good + s.gradeCounts.easy} known
              </p>
            </div>

            <div className="flex items-center gap-[var(--space-3)]">
              <Button
                variant="primary"
                onClick={() => setAppState({ phase: "idle" })}
              >
                Done
              </Button>
              {dueCount > 0 && (
                <Button
                  variant="ghost"
                  onClick={() => void startSession("flashcard")}
                >
                  Review again
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}
    </>
  );
}

// ── Grade buttons sub-component ──────────────────────────────────────────────

interface GradeButtonsProps {
  onGrade: (g: Grade) => void;
  disabled: boolean;
  goodRef: React.RefObject<HTMLButtonElement | null>;
}

const GRADES: {
  grade: Grade;
  label: string;
  key: string;
  tooltip: string;
  icon: React.ReactNode;
  variant: "outline" | "primary";
  tintClass: string;
  hoverStyle?: React.CSSProperties;
}[] = [
  {
    grade: "again",
    label: "Again",
    key: "1",
    tooltip: "Didn't remember — repeat today",
    icon: <RotateCcw size={14} aria-hidden />,
    variant: "outline",
    tintClass: "text-[color:var(--danger-text)]",
    hoverStyle: { "--hover-bg": "color-mix(in srgb, var(--danger) 10%, transparent)" } as React.CSSProperties,
  },
  {
    grade: "hard",
    label: "Hard",
    key: "2",
    tooltip: "Remembered with difficulty — review sooner",
    icon: <Frown size={14} aria-hidden />,
    variant: "outline",
    tintClass: "text-[color:var(--warning-text)]",
    hoverStyle: { "--hover-bg": "color-mix(in srgb, var(--warning) 10%, transparent)" } as React.CSSProperties,
  },
  {
    grade: "good",
    label: "Good",
    key: "3",
    tooltip: "Remembered well — normal interval",
    icon: <Check size={14} aria-hidden />,
    variant: "primary",
    tintClass: "",
  },
  {
    grade: "easy",
    label: "Easy",
    key: "4",
    tooltip: "Too easy — longer interval next time",
    icon: <ChevronsRight size={14} aria-hidden />,
    variant: "outline",
    tintClass: "text-[color:var(--success-text)]",
    hoverStyle: { "--hover-bg": "color-mix(in srgb, var(--success) 10%, transparent)" } as React.CSSProperties,
  },
];

function GradeButtons({ onGrade, disabled, goodRef }: GradeButtonsProps) {
  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-4 gap-[var(--space-2)] w-full"
      style={{ marginTop: "var(--space-4)" }}
    >
      {GRADES.map(({ grade, label, key, tooltip, icon, variant, tintClass, hoverStyle }) => (
        <button
          key={grade}
          ref={grade === "good" ? goodRef : undefined}
          type="button"
          disabled={disabled}
          onClick={() => onGrade(grade)}
          title={tooltip}
          style={hoverStyle}
          className={cn(
            "flex flex-col items-center justify-center gap-0.5",
            "h-11 min-h-[44px] px-[var(--space-2)] w-full",
            "rounded-[var(--radius-md)] font-semibold select-none",
            "transition-[background-color,border-color,box-shadow,transform]",
            "[transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-standard)]",
            "active:translate-y-px",
            "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
            focusRing,
            variant === "primary"
              ? "bg-primary text-on-primary shadow-[var(--shadow-sm)] hover:bg-primary-hover active:shadow-none"
              : "bg-transparent text-text border border-border-strong hover:bg-[color:var(--hover-bg)]",
          )}
        >
          <span className={cn("inline-flex items-center gap-[var(--space-1)]", tintClass)}>
            {icon}
            <span className="text-[length:var(--text-sm)]">{label}</span>
          </span>
          <span className="hidden sm:block text-[length:var(--text-xs)] text-text-subtle">
            {key}
          </span>
        </button>
      ))}
    </div>
  );
}
