"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { useOnboardingWizard, TOTAL_STEPS } from "./useOnboardingWizard";
import { STEP_TITLES, StepLevel } from "./steps/StepLevel";
import { StepPlacement } from "./steps/StepPlacement";
import { StepTopics } from "./steps/StepTopics";
import { StepAbout } from "./steps/StepAbout";
import { StepReview } from "./steps/StepReview";

type Defaults = {
  ageRange: string;
  gender: string;
  englishLevel: string;
  topics: string[];
};

export default function OnboardingForm({ defaults }: { defaults: Defaults }) {
  const {
    step,
    goNext,
    goBack,
    skipStep,
    goToStep,
    ageRange,
    setAgeRange,
    gender,
    setGender,
    englishLevel,
    setEnglishLevel,
    topics,
    toggleTopic,
    placementQuestions,
    placementAnswers,
    handlePlacementAnswer,
    suggestedPlacementLevel,
    suggestionAccepted,
    handleAcceptSuggestion,
    handleDismissSuggestion,
    handleFinish,
    submitting,
    error,
    headingRef,
  } = useOnboardingWizard(defaults);

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
            onJump={goToStep}
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
