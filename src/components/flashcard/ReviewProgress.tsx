"use client";

import { Button } from "@/components/ui/Button";
import { CardTitle } from "@/components/ui/Card";
import type { RefObject } from "react";
import type { ReviewMode } from "./types";

interface ReviewProgressProps {
  index: number;
  total: number;
  mode: ReviewMode;
  sessionRegionRef: RefObject<HTMLDivElement | null>;
  onEndSession: () => void;
}

function reviewTitle(mode: ReviewMode) {
  return mode === "cloze" ? "Cloze review" : "Reviewing";
}

function reviewLabel(mode: ReviewMode) {
  return mode === "cloze" ? "Cloze review" : "Flashcard review";
}

/** Session header with card counter, progress bar, and end-session button. */
export function ReviewProgress({
  index,
  total,
  mode,
  sessionRegionRef,
  onEndSession,
}: ReviewProgressProps) {
  return (
    <>
      <div
        ref={sessionRegionRef}
        tabIndex={-1}
        role="group"
        aria-label={reviewLabel(mode)}
        className="flex items-center justify-between gap-[var(--space-4)] outline-none"
      >
        <CardTitle level="h2" className="text-[length:var(--text-2xl)]">
          {reviewTitle(mode)}
        </CardTitle>
        <div className="flex items-center gap-[var(--space-3)]">
          <span className="text-[length:var(--text-sm)] text-text-muted">
            {index + 1} of {total}
          </span>
          <Button variant="ghost" size="sm" onClick={onEndSession}>
            End session
          </Button>
        </div>
      </div>

      <div className="mt-[var(--space-3)]">
        <div
          role="progressbar"
          aria-valuenow={index}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label="Review session progress"
          className="w-full h-1 rounded-full bg-border overflow-hidden"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-[var(--duration-base)]"
            style={{ width: `${(index / total) * 100}%` }}
          />
        </div>
      </div>
    </>
  );
}
