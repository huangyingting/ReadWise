"use client";

import { cn } from "@/lib/cn";
import { GradeButtons } from "./GradeButtons";
import { PronounceButton, ShowAnswerButton } from "./FlashcardPrimitives";
import type { DueCard, Grade } from "./types";

interface FlashcardFaceProps {
  card: DueCard;
  flipped: boolean;
  grading: boolean;
  speechAvailable: boolean;
  speaking: string | null;
  showAnswerRef: React.RefObject<HTMLButtonElement | null>;
  goodButtonRef: React.RefObject<HTMLButtonElement | null>;
  onFlip: () => void;
  onSpeak: (word: string, cardId: string) => void;
  onGrade: (grade: Grade) => void;
}

/** Classic flip-card faces: word on front, definition + context on back. */
export function FlashcardFace({
  card,
  flipped,
  grading,
  speechAvailable,
  speaking,
  showAnswerRef,
  goodButtonRef,
  onFlip,
  onSpeak,
  onGrade,
}: FlashcardFaceProps) {
  return (
    <div className="rw-flip mt-[var(--space-5)] min-h-[calc(var(--space-12)*2+var(--space-7))]">
      <div
        data-flipped={flipped ? "true" : "false"}
        className="rw-flip-inner min-h-[calc(var(--space-12)*2+var(--space-7))]"
      >
        {/* Front face */}
        <div
          className={cn(
            "rw-flip-face",
            "flex flex-col items-center justify-center text-center gap-[var(--space-4)] p-[var(--space-4)]",
            flipped ? "opacity-0" : "opacity-100",
          )}
        >
          <p
            className="max-w-[52ch] font-[family-name:var(--font-display)] text-[length:var(--text-3xl)] font-semibold text-text m-0"
          >
            {card.word}
          </p>

          {speechAvailable && (
            <PronounceButton
              word={card.word}
              cardId={card.id}
              speaking={speaking}
              onSpeak={onSpeak}
            />
          )}

          <p className="text-[length:var(--text-sm)] text-text-subtle m-0">
            Tap or press{" "}
            <kbd className="font-[family-name:var(--font-sans)] bg-bg-subtle border border-border rounded-[var(--radius-sm)] px-1 text-[length:var(--text-xs)]">
              Space
            </kbd>{" "}
            to reveal
          </p>
          <ShowAnswerButton
            showAnswerRef={showAnswerRef}
            flipped={flipped}
            onFlip={onFlip}
          >
            Show answer
          </ShowAnswerButton>
        </div>

        {/* Back face */}
        <div
          className={cn(
            "rw-flip-face rw-flip-back",
            "flex flex-col items-center justify-center text-center gap-[var(--space-4)] p-[var(--space-4)]",
            flipped ? "opacity-100" : "opacity-0",
          )}
        >
          <p className="font-[family-name:var(--font-display)] text-[length:var(--text-xl)] font-semibold text-text-muted m-0">
            {card.word}
          </p>

          {speechAvailable && flipped && (
            <PronounceButton
              word={card.word}
              cardId={card.id}
              speaking={speaking}
              onSpeak={onSpeak}
            />
          )}

          {card.explanation ? (
            <p
              className="max-w-[52ch] text-[length:var(--text-base)] text-text m-0"
            >
              {card.explanation}
            </p>
          ) : null}

          {card.contextSentence ? (
            <div
              className="flex max-w-[52ch] flex-col gap-[var(--space-1)]"
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
              className="max-w-[52ch] font-[family-name:var(--font-reading)] italic text-[length:var(--text-base)] text-text-muted m-0"
            >
              &ldquo;{card.example}&rdquo;
            </p>
          ) : null}

          {card.articleId ? (
            <a
              href={`/reader/${card.articleId}`}
              className="inline-flex items-center gap-[var(--space-1)] text-[length:var(--text-sm)] text-text-muted hover:text-primary underline underline-offset-2 transition-colors"
              aria-label={`Go to article where "${card.word}" was saved`}
            >
              Go to article ↗
            </a>
          ) : null}

          <GradeButtons
            onGrade={onGrade}
            disabled={grading}
            goodRef={goodButtonRef}
          />
        </div>
      </div>
    </div>
  );
}
