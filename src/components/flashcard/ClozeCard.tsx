"use client";

import { Volume2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn, focusRing } from "@/lib/cn";
import { GradeButtons } from "./GradeButtons";
import type { DueCard, Grade } from "./types";

interface ClozeCardProps {
  card: DueCard;
  clozeInput: string;
  clozeSubmitted: boolean;
  clozeCorrect: boolean | null;
  /** Used by definition-fallback path (no cloze data on card). */
  flipped: boolean;
  grading: boolean;
  speechAvailable: boolean;
  speaking: string | null;
  showAnswerRef: React.RefObject<HTMLButtonElement | null>;
  goodButtonRef: React.RefObject<HTMLButtonElement | null>;
  clozeInputRef: React.RefObject<HTMLInputElement | null>;
  onClozeInput: (value: string) => void;
  onSubmitCloze: (input: string) => void;
  /** Used by definition-fallback path. */
  onFlip: () => void;
  onSpeak: (word: string, cardId: string) => void;
  onGrade: (grade: Grade) => void;
}

/**
 * Cloze fill-in-the-blank card.
 *
 * Two paths:
 * - `card.cloze` present: show masked sentence → input → feedback + grade buttons
 * - `card.cloze` absent:  definition fallback — show word → "Show definition" flip
 *
 * Cloze privacy invariant: pronunciation is disabled until the answer is
 * revealed so the browser's TTS cannot leak the masked word.
 */
export function ClozeCard({
  card,
  clozeInput,
  clozeSubmitted,
  clozeCorrect,
  flipped,
  grading,
  speechAvailable,
  speaking,
  showAnswerRef,
  goodButtonRef,
  clozeInputRef,
  onClozeInput,
  onSubmitCloze,
  onFlip,
  onSpeak,
  onGrade,
}: ClozeCardProps) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center gap-[var(--space-4)] p-[var(--space-4)]"
      style={{ marginTop: "var(--space-5)", minHeight: "220px" }}
    >
      <p className="text-[length:var(--text-sm)] text-text-muted m-0">
        Fill in the blank:
      </p>

      {/* Masked sentence or definition-fallback word */}
      {card.cloze ? (
        <p
          className="font-[family-name:var(--font-reading)] text-[length:var(--text-lg)] text-text m-0"
          style={{ maxWidth: "52ch" }}
        >
          {card.cloze.masked}
        </p>
      ) : (
        <>
          <p className="font-[family-name:var(--font-display)] text-[length:var(--text-3xl)] font-semibold text-text m-0">
            {card.word}
          </p>
          <p className="text-[length:var(--text-sm)] text-text-muted m-0 italic">
            (No example available — definition mode)
          </p>
        </>
      )}

      {/* Audio button — disabled until the masked answer is revealed to
          preserve cloze privacy. */}
      {speechAvailable &&
        (() => {
          const pronounceEnabled = !card.cloze || clozeSubmitted;
          return (
            <button
              type="button"
              onClick={() =>
                pronounceEnabled ? onSpeak(card.word, card.id) : undefined
              }
              disabled={!pronounceEnabled}
              aria-label="Play pronunciation"
              title={pronounceEnabled ? undefined : "Available after you answer"}
              className={cn(
                "inline-flex items-center gap-[var(--space-1)] text-text-muted hover:text-text",
                "min-h-[44px] px-[var(--space-2)]",
                "text-[length:var(--text-sm)] transition-colors",
                "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-text-muted",
                focusRing,
              )}
            >
              <Volume2 size={16} aria-hidden />
              {speaking === card.id ? "Playing…" : "Pronounce"}
            </button>
          );
        })()}

      {/* Input form — only when cloze data is available and not yet submitted */}
      {card.cloze && !clozeSubmitted && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmitCloze(clozeInput);
          }}
          className="flex flex-col items-center gap-[var(--space-3)] w-full"
          style={{ maxWidth: "32ch" }}
        >
          <input
            ref={clozeInputRef}
            type="text"
            value={clozeInput}
            onChange={(e) => onClozeInput(e.target.value)}
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
            disabled={clozeInput.trim() === ""}
          >
            Check
          </Button>
        </form>
      )}

      {/* Feedback after cloze submission */}
      {clozeSubmitted && (
        <div className="flex flex-col items-center gap-[var(--space-3)]">
          <p
            className={cn(
              "font-semibold text-[length:var(--text-base)] m-0",
              clozeCorrect
                ? "text-[color:var(--success-text)]"
                : "text-[color:var(--danger-text)]",
            )}
          >
            {clozeCorrect
              ? "✓ Correct!"
              : `✗ The answer was: ${card.word}`}
          </p>
          {card.explanation && (
            <p
              className="text-[length:var(--text-sm)] text-text-muted m-0"
              style={{ maxWidth: "52ch" }}
            >
              {card.explanation}
            </p>
          )}
          <GradeButtons
            onGrade={onGrade}
            disabled={grading}
            goodRef={goodButtonRef}
          />
        </div>
      )}

      {/* Definition-fallback controls (no cloze data on card) */}
      {!card.cloze && (
        <div className="flex flex-col items-center gap-[var(--space-3)] w-full">
          {!flipped ? (
            <button
              ref={showAnswerRef}
              type="button"
              onClick={onFlip}
              aria-expanded={flipped}
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
                <p
                  className="text-[length:var(--text-base)] text-text m-0"
                  style={{ maxWidth: "52ch" }}
                >
                  {card.explanation}
                </p>
              )}
              <GradeButtons
                onGrade={onGrade}
                disabled={grading}
                goodRef={goodButtonRef}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
