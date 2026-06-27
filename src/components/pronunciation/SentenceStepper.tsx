"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton } from "@/components/ui";

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
      <IconButton
        size="sm"
        context="reading"
        className="rw-speak-stepper-btn"
        onClick={onPrev}
        disabled={currentIndex === 0}
        aria-label="Previous sentence"
      >
        <ChevronLeft size={16} aria-hidden />
      </IconButton>

      <span
        className="rw-speak-stepper-counter"
        aria-live="polite"
        aria-atomic="true"
      >
        {currentIndex + 1} of {sentenceCount}
      </span>

      <IconButton
        size="sm"
        context="reading"
        className="rw-speak-stepper-btn"
        onClick={onNext}
        disabled={currentIndex === sentenceCount - 1}
        aria-label="Next sentence"
      >
        <ChevronRight size={16} aria-hidden />
      </IconButton>
    </div>
  );
}
