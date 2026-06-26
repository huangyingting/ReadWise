"use client";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import { GradeButtons } from "./GradeButtons";
import { PronounceButton, ShowAnswerButton } from "./FlashcardPrimitives";
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
      {speechAvailable && (
        <PronounceButton
          word={card.word}
          cardId={card.id}
          speaking={speaking}
          disabled={!!card.cloze && !clozeSubmitted}
          disabledTitle="Available after you answer"
          onSpeak={onSpeak}
        />
      )}

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
          <Input
            ref={clozeInputRef}
            type="text"
            value={clozeInput}
            onChange={(e) => onClozeInput(e.target.value)}
            placeholder={`${"_".repeat(card.cloze.answerLength)}`}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            className="text-center"
            aria-label="Your answer"
            invalid={clozeSubmitted && !clozeCorrect}
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
            <ShowAnswerButton
              showAnswerRef={showAnswerRef}
              flipped={flipped}
              onFlip={onFlip}
            >
              Show definition
            </ShowAnswerButton>
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
