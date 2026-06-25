"use client";

import { ENGLISH_LEVELS, type EnglishLevel } from "@/lib/option-registries";
import { CefrBadge, type CefrLevel } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";

const LEVEL_DESCRIPTIONS: Record<string, string> = {
  A1: "Beginner",
  A2: "Elementary",
  B1: "Intermediate",
  B2: "Upper-intermediate",
  C1: "Advanced",
  C2: "Proficient",
};

export const STEP_TITLES = [
  "Your English level",
  "Confirm your level",
  "What do you like to read?",
  "A little about you",
  "You're all set!",
] as const;

export function StepLevel({
  headingRef,
  value,
  onChange,
  error,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  value: string;
  onChange: (v: string) => void;
  error: string | null;
}) {
  return (
    <div>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text leading-[var(--leading-snug)] mb-[var(--space-4)] outline-none"
      >
        {STEP_TITLES[0]}
      </h2>
      <fieldset className="border-0 p-0 m-0">
        <legend className="sr-only">English level</legend>
        <div className="flex flex-col gap-[var(--space-2)] sm:grid sm:grid-cols-2 sm:gap-[var(--space-3)]">
          {ENGLISH_LEVELS.map((level) => {
            const selected = value === level;
            return (
              <label
                key={level}
                className={cn(
                  "flex items-center gap-[var(--space-3)]",
                  "border rounded-[var(--radius-md)] p-[var(--space-4)] cursor-pointer",
                  "transition-[background-color,border-color] [transition-duration:var(--duration-fast)]",
                  "has-[:focus-visible]:[box-shadow:0_0_0_2px_var(--ring-offset),0_0_0_4px_var(--focus-ring)]",
                  selected
                    ? "border-primary bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]"
                    : "border-border-strong bg-surface hover:border-text-subtle",
                )}
              >
                <input
                  type="radio"
                  name="englishLevel"
                  value={level}
                  checked={selected}
                  onChange={() => onChange(level)}
                  className="sr-only"
                />
                <CefrBadge level={level as CefrLevel} />
                <span className="text-text text-[length:var(--text-sm)] font-medium">
                  {LEVEL_DESCRIPTIONS[level] ?? level}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {error && (
        <p
          role="alert"
          className="mt-[var(--space-2)] text-danger-text text-[length:var(--text-sm)]"
        >
          {error}
        </p>
      )}
    </div>
  );
}
