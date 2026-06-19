"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Layers,
  RotateCcw,
  Minus,
  Check,
  ChevronsRight,
  CircleCheck,
  CheckCircle2,
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
};

type AppState =
  | { phase: "idle" }
  | { phase: "loading" }
  | {
      phase: "session";
      cards: DueCard[];
      index: number;
      flipped: boolean;
      grading: boolean;
      gradeCounts: Record<Grade, number>;
    }
  | { phase: "complete"; total: number; gradeCounts: Record<Grade, number> };

interface FlashcardReviewProps {
  /** Due count from SSR — avoids an extra fetch on mount. */
  initialDueCount: number;
}

/**
 * Flashcard review session (SRS). Client component.
 *
 * States: idle → loading → session (flip/grade loop) → complete → idle.
 * Fetches cards from GET /api/study/flashcards on start;
 * grades via POST /api/study/flashcards/grade (optimistic advance).
 *
 * Keyboard map (§5.2 of Saul's spec):
 *   Space/Enter (front) = flip; 1=Again, 2=Hard, 3=Good, 4=Easy (back); Esc=end.
 */
export default function FlashcardReview({
  initialDueCount,
}: FlashcardReviewProps) {
  const [appState, setAppState] = useState<AppState>({ phase: "idle" });
  const [dueCount, setDueCount] = useState(initialDueCount);

  // Always-fresh state ref for stable callbacks
  const appStateRef = useRef<AppState>(appState);
  useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);

  // DOM refs
  const liveRef = useRef<HTMLDivElement>(null);
  const showAnswerRef = useRef<HTMLButtonElement>(null);
  const goodButtonRef = useRef<HTMLButtonElement>(null);

  /** Politely announce to screen readers. */
  function announce(msg: string) {
    // Clear then set so repeated messages are re-announced
    if (liveRef.current) {
      liveRef.current.textContent = "";
      requestAnimationFrame(() => {
        if (liveRef.current) liveRef.current.textContent = msg;
      });
    }
  }

  async function startSession() {
    setAppState({ phase: "loading" });
    try {
      const res = await fetch("/api/study/flashcards");
      if (!res.ok) throw new Error("fetch failed");
      const data = (await res.json()) as { cards: DueCard[]; dueCount: number };
      setDueCount(data.dueCount);
      if (data.cards.length === 0) {
        setAppState({ phase: "idle" });
        return;
      }
      setAppState({
        phase: "session",
        cards: data.cards,
        index: 0,
        flipped: false,
        grading: false,
        gradeCounts: { again: 0, hard: 0, good: 0, easy: 0 },
      });
    } catch {
      setAppState({ phase: "idle" });
    }
  }

  /** Flip the card to reveal answer. Stable ref pattern. */
  const flipCard = useCallback(() => {
    const s = appStateRef.current;
    if (s.phase !== "session" || s.flipped) return;
    setAppState((prev) =>
      prev.phase === "session" ? { ...prev, flipped: true } : prev,
    );
    announce("Answer revealed");
    setTimeout(() => goodButtonRef.current?.focus(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Submit a grade, advance to next card or complete. Stable ref pattern. */
  const submitGrade = useCallback(
    async (g: Grade) => {
      const s = appStateRef.current;
      if (s.phase !== "session" || !s.flipped || s.grading) return;

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
          };
        });
        setTimeout(() => showAnswerRef.current?.focus(), 0);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      if (!s.flipped) {
        if (e.key === " " || e.key === "Enter") {
          // Only if the active element is not already a button (avoid double-fire)
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
              <Button
                variant="primary"
                leadingIcon={<Layers size={16} aria-hidden />}
                onClick={() => void startSession()}
              >
                Review {dueCount} due
              </Button>
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

      {s.phase === "session" && (
        <Card>
          {/* Session header */}
          <div className="flex items-center justify-between gap-[var(--space-4)]">
            <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text m-0">
              Reviewing
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
                style={{
                  width: `${(s.index / s.cards.length) * 100}%`,
                }}
              />
            </div>
          </div>

          {/* Flashcard */}
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
                  {s.cards[s.index].word}
                </p>
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
                  {s.cards[s.index].word}
                </p>

                {/* Explanation */}
                {s.cards[s.index].explanation ? (
                  <p
                    className="text-[length:var(--text-base)] text-text m-0"
                    style={{ maxWidth: "52ch" }}
                  >
                    {s.cards[s.index].explanation}
                  </p>
                ) : null}

                {/* Example */}
                {s.cards[s.index].example ? (
                  <p
                    className="font-[family-name:var(--font-reading)] italic text-[length:var(--text-base)] text-text-muted m-0"
                    style={{ maxWidth: "52ch" }}
                  >
                    &ldquo;{s.cards[s.index].example}&rdquo;
                  </p>
                ) : null}

                {/* Grade buttons row */}
                <GradeButtons onGrade={(g) => void submitGrade(g)} disabled={s.grading} goodRef={goodButtonRef} />
              </div>
            </div>
          </div>
        </Card>
      )}

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
                  onClick={() => void startSession()}
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
  icon: React.ReactNode;
  variant: "outline" | "primary";
  tintClass: string;
  hoverStyle?: React.CSSProperties;
}[] = [
  {
    grade: "again",
    label: "Again",
    key: "1",
    icon: <RotateCcw size={14} aria-hidden />,
    variant: "outline",
    tintClass: "text-[color:var(--danger-text)]",
    hoverStyle: { "--hover-bg": "color-mix(in srgb, var(--danger) 10%, transparent)" } as React.CSSProperties,
  },
  {
    grade: "hard",
    label: "Hard",
    key: "2",
    icon: <Minus size={14} aria-hidden />,
    variant: "outline",
    tintClass: "text-[color:var(--warning-text)]",
    hoverStyle: { "--hover-bg": "color-mix(in srgb, var(--warning) 10%, transparent)" } as React.CSSProperties,
  },
  {
    grade: "good",
    label: "Good",
    key: "3",
    icon: <Check size={14} aria-hidden />,
    variant: "primary",
    tintClass: "",
  },
  {
    grade: "easy",
    label: "Easy",
    key: "4",
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
      {GRADES.map(({ grade, label, key, icon, variant, tintClass, hoverStyle }) => (
        <button
          key={grade}
          ref={grade === "good" ? goodRef : undefined}
          type="button"
          disabled={disabled}
          onClick={() => onGrade(grade)}
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
