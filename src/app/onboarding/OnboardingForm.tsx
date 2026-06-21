"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Check, ArrowLeft, ArrowRight } from "lucide-react";
import { CATEGORIES } from "@/lib/categories";
import { AGE_RANGES, ENGLISH_LEVELS, GENDERS, LEVEL_HINTS } from "@/lib/profile";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { CefrBadge, Badge, type CefrLevel } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";

type Defaults = {
  ageRange: string;
  gender: string;
  englishLevel: string;
  topics: string[];
};

const LEVEL_DESCRIPTIONS: Record<string, string> = {
  A1: "Beginner",
  A2: "Elementary",
  B1: "Intermediate",
  B2: "Upper-intermediate",
  C1: "Advanced",
  C2: "Proficient",
};

const STEP_TITLES = [
  "Your English level",
  "What do you like to read?",
  "A little about you",
  "You're all set!",
];

const TOTAL_STEPS = 4;

/* ── Step sub-components ──────────────────────────────────────── */

function StepLevel({
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

function StepTopics({
  headingRef,
  topics,
  toggleTopic,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  topics: string[];
  toggleTopic: (slug: string) => void;
}) {
  return (
    <div>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text leading-[var(--leading-snug)] mb-[var(--space-1)] outline-none"
      >
        {STEP_TITLES[1]}
      </h2>
      <p className="text-text-subtle text-xs mb-[var(--space-4)]">
        Pick any that interest you — or none.
      </p>
      <div
        role="group"
        aria-label="Topics you enjoy"
        className="flex flex-wrap gap-[var(--space-2)]"
      >
        {CATEGORIES.map((cat) => {
          const selected = topics.includes(cat.slug);
          return (
            <button
              key={cat.slug}
              type="button"
              aria-pressed={selected}
              onClick={() => toggleTopic(cat.slug)}
              className={cn(
                "inline-flex items-center gap-[var(--space-1)]",
                "min-h-[40px] px-[var(--space-4)]",
                "text-[length:var(--text-sm)] rounded-[var(--radius-full)]",
                "border transition-[background-color,border-color,color]",
                "[transition-duration:var(--duration-fast)]",
                "outline-none focus-visible:[box-shadow:0_0_0_2px_var(--ring-offset),0_0_0_4px_var(--focus-ring)]",
                selected
                  ? "bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-primary-text border-primary"
                  : "bg-bg-subtle text-text-muted border-border hover:border-border-strong",
              )}
            >
              {selected && (
                <Check
                  size={14}
                  aria-hidden
                  className="rw-pop shrink-0"
                />
              )}
              {cat.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepAbout({
  headingRef,
  ageRange,
  gender,
  onAgeChange,
  onGenderChange,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  ageRange: string;
  gender: string;
  onAgeChange: (v: string) => void;
  onGenderChange: (v: string) => void;
}) {
  return (
    <div>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text leading-[var(--leading-snug)] mb-[var(--space-1)] outline-none"
      >
        {STEP_TITLES[2]}{" "}
        <Badge variant="neutral" className="ml-[var(--space-2)]">Optional</Badge>
      </h2>
      <p className="text-text-subtle text-xs mb-[var(--space-4)]">
        Optional — helps us pick relevant articles for you.
      </p>
      <div className="flex flex-col gap-[var(--space-4)] sm:grid sm:grid-cols-2">
        <Field label="Age range">
          <Select
            value={ageRange}
            onChange={(e) => onAgeChange(e.target.value)}
          >
            <option value="">Prefer not to say</option>
            {AGE_RANGES.map((range) => (
              <option key={range} value={range}>
                {range}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Gender">
          <Select
            value={gender}
            onChange={(e) => onGenderChange(e.target.value)}
          >
            <option value="">Prefer not to say</option>
            {GENDERS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </div>
  );
}

function StepReview({
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
        {STEP_TITLES[3]}
      </h2>
      <p className="text-text-muted text-[length:var(--text-sm)] mb-[var(--space-5)]">
        Here&apos;s a quick summary. You can edit these anytime in Settings.
      </p>

      <div className="flex flex-col divide-y divide-border">
        {/* Level row */}
        <div className="flex items-center justify-between py-[var(--space-3)]">
          <div>
            <div className="text-text-subtle text-xs">Level</div>
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
            <div className="text-text-subtle text-xs">Topics</div>
            <div className="text-text font-medium text-[length:var(--text-sm)] mt-0.5">
              {topicLabels || (
                <span className="text-text-muted italic">
                  No topics selected
                </span>
              )}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onJump(2)}>
            Edit
          </Button>
        </div>

        {/* About row (only if set) */}
        {aboutParts.length > 0 && (
          <div className="flex items-center justify-between py-[var(--space-3)]">
            <div>
              <div className="text-text-subtle text-xs">About you</div>
              <div className="text-text font-medium text-[length:var(--text-sm)] mt-0.5">
                {aboutParts.join(" · ")}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onJump(3)}>
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

/* ── Main wizard component ────────────────────────────────────── */

export default function OnboardingForm({ defaults }: { defaults: Defaults }) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [ageRange, setAgeRange] = useState(defaults.ageRange);
  const [gender, setGender] = useState(defaults.gender);
  const [englishLevel, setEnglishLevel] = useState(defaults.englishLevel);
  const [topics, setTopics] = useState<string[]>(defaults.topics);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Focus the step heading on step change for AT announcement + keyboard reset.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  function toggleTopic(slug: string) {
    setTopics((prev) =>
      prev.includes(slug) ? prev.filter((t) => t !== slug) : [...prev, slug],
    );
  }

  function goNext() {
    if (step === 1 && !englishLevel) {
      setError("Please select your English level.");
      return;
    }
    setError(null);
    setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  }

  function goBack() {
    setError(null);
    setStep((s) => Math.max(s - 1, 1));
  }

  function skipStep() {
    setError(null);
    setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  }

  async function handleFinish() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ageRange, gender, englishLevel, topics }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(data?.error ?? "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }
      router.push("/welcome");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <Card className="mt-[var(--space-6)] flex flex-col gap-[var(--space-5)]">
       {/* Progress stepper */}
      <div aria-label="Onboarding progress">
        <p
          className="text-text-subtle text-xs mb-[var(--space-3)]"
          aria-live="polite"
        >
          Step {step} of {TOTAL_STEPS} · {STEP_TITLES[step - 1]}
        </p>
        <nav aria-label="Onboarding steps">
          <ol className="flex gap-[var(--space-2)] list-none m-0 p-0">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => {
            const isDone = i + 1 < step;
            const isCurrent = i + 1 === step;
            return (
              <li
                key={i}
                aria-current={isCurrent ? "step" : undefined}
                className="flex-1 flex flex-col items-center gap-[var(--space-1)]"
              >
                {/* Numbered dot */}
                <span
                  aria-hidden
                  className={cn(
                    "inline-flex items-center justify-center",
                    "w-6 h-6 rounded-full text-[length:var(--text-xs)] font-bold",
                    "transition-[background-color,color] [transition-duration:var(--duration-base)] motion-reduce:transition-none",
                    isDone || isCurrent
                      ? "bg-primary text-on-primary"
                      : "bg-border text-text-subtle",
                  )}
                >
                  {isDone ? "✓" : i + 1}
                </span>
                {/* Progress bar segment */}
                <span
                  className={cn(
                    "block w-full h-1 rounded-[var(--radius-full)]",
                    "transition-[background-color] [transition-duration:var(--duration-base)] motion-reduce:transition-none",
                    isDone || isCurrent ? "bg-primary" : "bg-border",
                  )}
                />
              </li>
            );
          })}
          </ol>
        </nav>
      </div>

      {/* Step content — key forces remount per step, triggering rw-step animation */}
      <div key={step} className="rw-step">
        {step === 1 && (
          <StepLevel
            headingRef={headingRef}
            value={englishLevel}
            onChange={(v) => {
              setEnglishLevel(v);
              setError(null);
            }}
            error={error}
          />
        )}
        {step === 2 && (
          <StepTopics
            headingRef={headingRef}
            topics={topics}
            toggleTopic={toggleTopic}
          />
        )}
        {step === 3 && (
          <StepAbout
            headingRef={headingRef}
            ageRange={ageRange}
            gender={gender}
            onAgeChange={setAgeRange}
            onGenderChange={setGender}
          />
        )}
        {step === 4 && (
          <StepReview
            headingRef={headingRef}
            englishLevel={englishLevel}
            topics={topics}
            ageRange={ageRange}
            gender={gender}
            onJump={setStep}
            error={error}
          />
        )}
      </div>

      {/* Footer nav */}
      <div
        className={cn(
          "flex items-center gap-[var(--space-3)] mt-[var(--space-2)]",
          step === 1 ? "justify-end" : "justify-between",
        )}
      >
        {/* Left: Back */}
        {step > 1 && (
          <Button
            variant="ghost"
            leadingIcon={<ArrowLeft size={16} aria-hidden />}
            onClick={goBack}
          >
            Back
          </Button>
        )}

        {/* Right: Skip (steps 2-3) + Next or Finish */}
        <div className="flex items-center gap-[var(--space-3)]">
          {(step === 2 || step === 3) && (
            <Button variant="ghost" onClick={skipStep}>
              Skip for now
            </Button>
          )}
          {step < TOTAL_STEPS && (
            <Button
              variant="primary"
              trailingIcon={<ArrowRight size={16} aria-hidden />}
              onClick={goNext}
              disabled={step === 1 && !englishLevel}
            >
              Next
            </Button>
          )}
          {step === TOTAL_STEPS && (
            <Button
              variant="primary"
              loading={submitting}
              onClick={handleFinish}
            >
              Finish setup
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
