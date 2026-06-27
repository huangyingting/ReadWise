"use client";

/**
 * Shared card UI primitives used across FlashcardFace and ClozeCard.
 * Extracted to eliminate duplication (FE2-6) and centralise design-token usage (DSGN2-8).
 */
import { Volume2 } from "lucide-react";
import { Button } from "@/components/ui";

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
    <Button
      variant="ghost"
      size="sm"
      onClick={() => onSpeak(word, cardId)}
      disabled={disabled}
      aria-label={`Play pronunciation of ${word}`}
      title={disabled ? disabledTitle : undefined}
      leadingIcon={<Volume2 size={16} aria-hidden />}
      className="min-h-[44px] text-text-muted hover:text-text disabled:hover:text-text-muted"
    >
      {speaking === cardId ? "Playing…" : "Pronounce"}
    </Button>
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
    <Button
      ref={showAnswerRef}
      variant="secondary"
      size="md"
      onClick={onFlip}
      aria-expanded={flipped}
    >
      {children}
    </Button>
  );
}
