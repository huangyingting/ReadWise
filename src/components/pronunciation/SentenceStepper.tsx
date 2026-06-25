"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";

type Props = {
  currentIndex: number;
  sentenceCount: number;
  onPrev: () => void;
  onNext: () => void;
};

export function SentenceStepper({
  currentIndex,
  sentenceCount,
  onPrev,
  onNext,
}: Props) {
  return (
    <div className="rw-speak-stepper">
      <button
        type="button"
        className={cn("rw-speak-stepper-btn", focusRing)}
        onClick={onPrev}
        disabled={currentIndex === 0}
        aria-label="Previous sentence"
      >
        <ChevronLeft size={16} aria-hidden />
      </button>

      <span
        className="rw-speak-stepper-counter"
        aria-live="polite"
        aria-atomic="true"
      >
        {currentIndex + 1} of {sentenceCount}
      </span>

      <button
        type="button"
        className={cn("rw-speak-stepper-btn", focusRing)}
        onClick={onNext}
        disabled={currentIndex === sentenceCount - 1}
        aria-label="Next sentence"
      >
        <ChevronRight size={16} aria-hidden />
      </button>
    </div>
  );
}
