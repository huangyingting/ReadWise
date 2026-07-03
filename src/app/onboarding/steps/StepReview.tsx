"use client";

import type { RefObject, ReactNode } from "react";
import { CATEGORIES } from "@/lib/categories";
import { LEVEL_HINTS } from "@/lib/option-registries";
import { Button } from "@/components/ui/Button";
import { STEP_TITLES } from "./StepLevel";

type StepReviewProps = {
  headingRef: RefObject<HTMLHeadingElement | null>;
  englishLevel: string;
  topics: string[];
  ageRange: string;
  gender: string;
  onJump: (step: number) => void;
  error: string | null;
};

type SummaryRowProps = {
  label: string;
  children: ReactNode;
  editStep: number;
  onJump: (step: number) => void;
};

function getTopicLabels(topics: string[]) {
  return topics
    .map((slug) => CATEGORIES.find((c) => c.slug === slug)?.label)
    .filter(Boolean)
    .join(", ");
}

function SummaryRow({ label, children, editStep, onJump }: SummaryRowProps) {
  return (
    <div className="flex items-center justify-between py-[var(--space-3)]">
      <div>
        <div className="text-text-subtle text-[length:var(--text-xs)]">
          {label}
        </div>
        <div className="text-text font-medium text-[length:var(--text-sm)] mt-0.5">
          {children}
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={() => onJump(editStep)}>
        Edit
      </Button>
    </div>
  );
}

export function StepReview({
  headingRef,
  englishLevel,
  topics,
  ageRange,
  gender,
  onJump,
  error,
}: StepReviewProps) {
  const topicLabels = getTopicLabels(topics);
  const aboutParts = [ageRange, gender].filter(Boolean);

  return (
    <div>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text leading-[var(--leading-snug)] mb-[var(--space-1)] outline-none"
      >
        {STEP_TITLES[4]}
      </h2>
      <p className="text-text-muted text-[length:var(--text-sm)] mb-[var(--space-5)]">
        Here&apos;s a quick summary. You can edit these anytime in Settings.
      </p>

      <div className="flex flex-col divide-y divide-border">
        <SummaryRow label="Level" editStep={1} onJump={onJump}>
          {LEVEL_HINTS[englishLevel] ?? englishLevel}
        </SummaryRow>

        <SummaryRow label="Topics" editStep={3} onJump={onJump}>
          {topicLabels || (
            <span className="text-text-muted italic">No topics selected</span>
          )}
        </SummaryRow>

        {aboutParts.length > 0 && (
          <SummaryRow label="About you" editStep={4} onJump={onJump}>
            {aboutParts.join(" · ")}
          </SummaryRow>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mt-[var(--space-4)] text-danger-text text-[length:var(--text-sm)]"
        >
          {error}
        </p>
      )}
    </div>
  );
}
