"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Check, X, ArrowLeft, ArrowRight } from "lucide-react";
import { ApiResponseError, postJson } from "@/lib/client-fetch";
import { CATEGORIES } from "@/lib/categories";
import { AGE_RANGES, ENGLISH_LEVELS, GENDERS, LEVEL_HINTS, TopicSelector, type EnglishLevel } from "@/features/profile-preferences";
import {
  getPlacementQuestions,
  suggestLevel,
  type PlacementQuestion,
} from "@/lib/placement";
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
  "Confirm your level",
  "What do you like to read?",
  "A little about you",
  "You're all set!",
];

const TOTAL_STEPS = 5;

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

function StepPlacement({
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
  const score = answers.reduce<number>(
    (acc, a, i) => acc + (a === questions[i]?.correctIndex ? 1 : 0),
    0,
  );

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
      <p className="text-text-subtle text-xs mb-[var(--space-4)]">
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
                          ? "border-success bg-[color-mix(in_srgb,var(--success,#22c55e)_8%,transparent)] text-text"
                          : isRevealed && isWrong
                          ? "border-danger-text bg-[color-mix(in_srgb,var(--danger-text,#ef4444)_8%,transparent)] text-text"
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
                        <Check size={14} aria-hidden className="ml-auto text-[color:var(--success,#22c55e)]" />
                      )}
                      {isRevealed && isWrong && (
                        <X size={14} aria-hidden className="ml-auto text-[color:var(--danger-text,#ef4444)]" />
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
        {STEP_TITLES[2]}
      </h2>
      <p className="text-text-subtle text-xs mb-[var(--space-4)]">
        Pick any that interest you — or none.
      </p>
      <TopicSelector topics={topics} onToggle={toggleTopic} />
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
        {STEP_TITLES[3]}{" "}
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
      <p className="mt-[var(--space-4)] text-text-subtle text-xs">
        These fields are optional and stored in your profile. They are used
        solely to personalise article recommendations. You can update or clear
        them at any time in{" "}
        <strong className="font-medium text-text">Settings</strong>.
      </p>
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
        {STEP_TITLES[4]}
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
          <Button variant="ghost" size="sm" onClick={() => onJump(3)}>
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

  // Placement quiz state (#120)
  const [placementAnswers, setPlacementAnswers] = useState<(number | null)[]>([null, null, null]);
  const [suggestionAccepted, setSuggestionAccepted] = useState(false);

  const placementQuestions: PlacementQuestion[] =
    englishLevel && ENGLISH_LEVELS.includes(englishLevel as EnglishLevel)
      ? getPlacementQuestions(englishLevel as EnglishLevel)
      : [];

  const answeredCount = placementAnswers.filter((a) => a !== null).length;
  const placementScore = placementAnswers.reduce<number>(
    (acc, a, i) => acc + (a === placementQuestions[i]?.correctIndex ? 1 : 0),
    0,
  );
  const suggestedPlacementLevel: EnglishLevel | null =
    answeredCount === placementQuestions.length && englishLevel && ENGLISH_LEVELS.includes(englishLevel as EnglishLevel)
      ? suggestLevel(placementScore, placementQuestions.length, englishLevel as EnglishLevel)
      : null;

  // Focus the step heading on step change for AT announcement + keyboard reset.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  function toggleTopic(slug: string) {
    setTopics((prev) =>
      prev.includes(slug) ? prev.filter((t) => t !== slug) : [...prev, slug],
    );
  }

  function handlePlacementAnswer(qIdx: number, optIdx: number) {
    setPlacementAnswers((prev) => {
      const next = [...prev];
      next[qIdx] = optIdx;
      return next;
    });
  }

  function handleAcceptSuggestion() {
    if (suggestedPlacementLevel) {
      setEnglishLevel(suggestedPlacementLevel);
      setSuggestionAccepted(true);
    }
  }

  function handleDismissSuggestion() {
    setSuggestionAccepted(true);
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
      await postJson("/api/onboarding", { ageRange, gender, englishLevel, topics });
      router.push("/welcome");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiResponseError) {
        setError(err.message || "Something went wrong. Please try again.");
      } else {
        setError("Network error. Please try again.");
      }
    } finally {
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
              // Reset placement state when level changes
              setPlacementAnswers([null, null, null]);
              setSuggestionAccepted(false);
            }}
            error={error}
          />
        )}
        {step === 2 && (
          <StepPlacement
            headingRef={headingRef}
            selfReportedLevel={englishLevel}
            questions={placementQuestions}
            answers={placementAnswers}
            onAnswer={handlePlacementAnswer}
            suggestedLevel={suggestedPlacementLevel}
            onAcceptSuggestion={handleAcceptSuggestion}
            onDismissSuggestion={handleDismissSuggestion}
            suggestionAccepted={suggestionAccepted}
          />
        )}
        {step === 3 && (
          <StepTopics
            headingRef={headingRef}
            topics={topics}
            toggleTopic={toggleTopic}
          />
        )}
        {step === 4 && (
          <StepAbout
            headingRef={headingRef}
            ageRange={ageRange}
            gender={gender}
            onAgeChange={setAgeRange}
            onGenderChange={setGender}
          />
        )}
        {step === 5 && (
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

        {/* Right: Skip (placement + topics + about) + Next or Finish */}
        <div className="flex items-center gap-[var(--space-3)]">
          {(step === 2 || step === 3 || step === 4) && (
            <Button variant="ghost" onClick={skipStep}>
              {step === 2 ? "Skip – I know my level" : "Skip for now"}
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
