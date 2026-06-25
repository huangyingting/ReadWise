"use client";

import { Volume2 } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import { GradeButtons } from "./GradeButtons";
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
    <div
      className="rw-flip"
      style={{ marginTop: "var(--space-5)", minHeight: "220px" }}
    >
      <div
        className="rw-flip-inner"
        data-flipped={flipped ? "true" : "false"}
        style={{ minHeight: "220px" }}
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
            className="font-[family-name:var(--font-display)] text-[length:var(--text-3xl)] font-semibold text-text m-0"
            style={{ maxWidth: "52ch" }}
          >
            {card.word}
          </p>

          {speechAvailable && (
            <button
              type="button"
              onClick={() => onSpeak(card.word, card.id)}
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
            flipped ? "opacity-100" : "opacity-0",
          )}
        >
          <p className="font-[family-name:var(--font-display)] text-[length:var(--text-xl)] font-semibold text-text-muted m-0">
            {card.word}
          </p>

          {speechAvailable && flipped && (
            <button
              type="button"
              onClick={() => onSpeak(card.word, card.id)}
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

          {card.explanation ? (
            <p
              className="text-[length:var(--text-base)] text-text m-0"
              style={{ maxWidth: "52ch" }}
            >
              {card.explanation}
            </p>
          ) : null}

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
