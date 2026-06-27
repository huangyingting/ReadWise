"use client";

import { CATEGORIES } from "@/lib/categories";
import { LEVEL_HINTS } from "@/lib/option-registries";
import { Button } from "@/components/ui/Button";
import { STEP_TITLES } from "./StepLevel";

export function StepReview({
  headingRef,
  englishLevel,
  topics,
  ageRange,
  gender,
  onJump,
  error,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  englishLevel: string;
  topics: string[];
  ageRange: string;
  gender: string;
  onJump: (step: number) => void;
  error: string | null;
}) {
  const topicLabels = topics
    .map((slug) => CATEGORIES.find((c) => c.slug === slug)?.label)
    .filter(Boolean)
    .join(", ");

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
        {/* Level row */}
        <div className="flex items-center justify-between py-[var(--space-3)]">
          <div>
            <div className="text-text-subtle text-[length:var(--text-xs)]">Level</div>
            <div className="text-text font-medium text-[length:var(--text-sm)] mt-0.5">
              {LEVEL_HINTS[englishLevel] ?? englishLevel}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onJump(1)}>
            Edit
          </Button>
        </div>

        {/* Topics row */}
        <div className="flex items-center justify-between py-[var(--space-3)]">
          <div>
            <div className="text-text-subtle text-[length:var(--text-xs)]">Topics</div>
            <div className="text-text font-medium text-[length:var(--text-sm)] mt-0.5">
              {topicLabels || (
                <span className="text-text-muted italic">
                  No topics selected
                </span>
              )}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onJump(3)}>
            Edit
          </Button>
        </div>

        {/* About row (only if set) */}
        {aboutParts.length > 0 && (
          <div className="flex items-center justify-between py-[var(--space-3)]">
            <div>
              <div className="text-text-subtle text-[length:var(--text-xs)]">About you</div>
              <div className="text-text font-medium text-[length:var(--text-sm)] mt-0.5">
                {aboutParts.join(" · ")}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onJump(4)}>
              Edit
            </Button>
          </div>
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
