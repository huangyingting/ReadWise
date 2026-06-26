"use client";

/**
 * Shared card UI primitives used across FlashcardFace and ClozeCard.
 * Extracted to eliminate duplication (FE2-6) and centralise design-token usage (DSGN2-8).
 */
import { Volume2 } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";

// ── PronounceButton ────────────────────────────────────────────────────────

interface PronounceButtonProps {
  word: string;
  cardId: string;
  speaking: string | null;
  disabled?: boolean;
  /** Tooltip shown when the button is disabled. */
  disabledTitle?: string;
  onSpeak: (word: string, cardId: string) => void;
}

/**
 * Pronunciation playback button.
 *
 * When `disabled` the button is greyed out and `disabledTitle` is used as the
 * tooltip — this preserves the cloze privacy invariant (answer must be revealed
 * before TTS can speak the masked word).
 */
export function PronounceButton({
  word,
  cardId,
  speaking,
  disabled,
  disabledTitle,
  onSpeak,
}: PronounceButtonProps) {
  return (
    <button
      type="button"
      onClick={() => onSpeak(word, cardId)}
      disabled={disabled}
      aria-label={`Play pronunciation of ${word}`}
      title={disabled ? disabledTitle : undefined}
      className={cn(
        "inline-flex items-center gap-[var(--space-1)] text-text-muted hover:text-text",
        "min-h-[44px] px-[var(--space-2)]",
        "text-[length:var(--text-sm)] transition-colors",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-text-muted",
        focusRing,
      )}
    >
      <Volume2 size={16} aria-hidden />
      {speaking === cardId ? "Playing…" : "Pronounce"}
    </button>
  );
}

// ── ShowAnswerButton ───────────────────────────────────────────────────────

interface ShowAnswerButtonProps {
  showAnswerRef: React.RefObject<HTMLButtonElement | null>;
  flipped: boolean;
  onFlip: () => void;
  children: React.ReactNode;
}

/**
 * "Show answer" / "Show definition" reveal button.
 *
 * Renders a bordered surface button; passes `aria-expanded` to indicate the
 * revealed state to assistive technology.
 */
export function ShowAnswerButton({
  showAnswerRef,
  flipped,
  onFlip,
  children,
}: ShowAnswerButtonProps) {
  return (
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
      {children}
    </button>
  );
}
