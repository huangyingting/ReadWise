"use client";

import { Check, X } from "lucide-react";
import { LEVEL_HINTS } from "@/lib/option-registries";
import { type EnglishLevel } from "@/lib/option-registries";
import { computePlacementScore, type PlacementQuestion } from "@/lib/placement";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { STEP_TITLES } from "./StepLevel";

export function StepPlacement({
  headingRef,
  selfReportedLevel,
  questions,
  answers,
  onAnswer,
  suggestedLevel,
  onAcceptSuggestion,
  onDismissSuggestion,
  suggestionAccepted,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  selfReportedLevel: string;
  questions: PlacementQuestion[];
  answers: (number | null)[];
  onAnswer: (qIdx: number, optIdx: number) => void;
  suggestedLevel: EnglishLevel | null;
  onAcceptSuggestion: () => void;
  onDismissSuggestion: () => void;
  suggestionAccepted: boolean;
}) {
  const allAnswered = answers.every((a) => a !== null);
  const score = computePlacementScore(answers, questions);

  return (
    <div>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text leading-[var(--leading-snug)] mb-[var(--space-1)] outline-none"
      >
        {STEP_TITLES[1]}{" "}
        <Badge variant="neutral" className="ml-[var(--space-2)]">Optional</Badge>
      </h2>
      <p className="mb-[var(--space-4)] text-text-subtle text-[length:var(--text-xs)]">
        Answer 3 quick questions to confirm your self-reported level.
        This takes about 2 minutes.
      </p>

      <div className="flex flex-col gap-[var(--space-6)]">
        {questions.map((q, qi) => (
          <div key={q.id} className="flex flex-col gap-[var(--space-2)]">
            {/* Passage */}
            <blockquote className="border-l-2 border-primary pl-[var(--space-3)] text-text text-[length:var(--text-sm)] italic">
              {q.passage}
            </blockquote>
            {/* Question */}
            <p className="text-text font-medium text-[length:var(--text-sm)]">
              {qi + 1}. {q.question}
            </p>
            {/* Options */}
            <fieldset className="border-0 p-0 m-0">
              <legend className="sr-only">{q.question}</legend>
              <div className="flex flex-col gap-[var(--space-2)]">
                {q.options.map((opt, oi) => {
                  const isSelected = answers[qi] === oi;
                  const isRevealed = allAnswered;
                  const isCorrect = oi === q.correctIndex;
                  const isWrong = isSelected && !isCorrect;
                  return (
                    <label
                      key={oi}
                      className={cn(
                        "flex items-center gap-[var(--space-3)]",
                        "border rounded-[var(--radius-md)] p-[var(--space-3)] cursor-pointer text-[length:var(--text-sm)]",
                        "transition-[background-color,border-color] [transition-duration:var(--duration-fast)]",
                        "has-[:focus-visible]:[box-shadow:0_0_0_2px_var(--ring-offset),0_0_0_4px_var(--focus-ring)]",
                        isRevealed && isCorrect
                          ? "border-success bg-[color-mix(in_srgb,var(--success)_8%,transparent)] text-text"
                          : isRevealed && isWrong
                          ? "border-danger-text bg-[color-mix(in_srgb,var(--danger-text)_8%,transparent)] text-text"
                          : isSelected
                          ? "border-primary bg-[color-mix(in_srgb,var(--primary)_8%,transparent)] text-text"
                          : "border-border-strong bg-surface hover:border-text-subtle text-text",
                        allAnswered && "pointer-events-none",
                      )}
                    >
                      <input
                        type="radio"
                        name={`placement-q${qi}`}
                        value={oi}
                        checked={isSelected}
                        disabled={allAnswered}
                        onChange={() => onAnswer(qi, oi)}
                        className="sr-only"
                      />
                      {opt}
                      {isRevealed && isCorrect && (
                        <Check size={14} aria-hidden className="ml-auto text-success-text" />
                      )}
                      {isRevealed && isWrong && (
                        <X size={14} aria-hidden className="ml-auto text-danger-text" />
                      )}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </div>
        ))}
      </div>

      {/* Score + suggestion */}
      {allAnswered && (
        <div className="mt-[var(--space-5)] p-[var(--space-4)] border rounded-[var(--radius-md)] border-border bg-bg-subtle">
          <p className="text-text font-medium text-[length:var(--text-sm)]">
            You got {score} out of {questions.length} correct.
          </p>
          {suggestedLevel && !suggestionAccepted ? (
            <>
              <p className="mt-[var(--space-2)] text-text-muted text-[length:var(--text-sm)]">
                Your answers suggest you might be more comfortable at{" "}
                <strong>{LEVEL_HINTS[suggestedLevel] ?? suggestedLevel}</strong>.
                Would you like to adjust?
              </p>
              <div className="flex gap-[var(--space-2)] mt-[var(--space-3)]">
                <Button variant="primary" size="sm" onClick={onAcceptSuggestion}>
                  Yes, use {suggestedLevel}
                </Button>
                <Button variant="ghost" size="sm" onClick={onDismissSuggestion}>
                  Keep {selfReportedLevel}
                </Button>
              </div>
            </>
          ) : suggestionAccepted ? (
            <p className="mt-[var(--space-2)] text-text-muted text-[length:var(--text-sm)]">
              ✓ Level updated to <strong>{LEVEL_HINTS[selfReportedLevel] ?? selfReportedLevel}</strong>.
            </p>
          ) : (
            <p className="mt-[var(--space-2)] text-text-muted text-[length:var(--text-sm)]">
              Great job! Your selected level looks right.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
