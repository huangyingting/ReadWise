"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import {
  useOnboardingWizard,
  TOTAL_STEPS,
  type OnboardingWizardState,
} from "./useOnboardingWizard";
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

function ProgressStepper({ step }: { step: number }) {
  return (
    <div aria-label="Onboarding progress">
      <p
        className="mb-[var(--space-3)] text-text-subtle text-[length:var(--text-xs)]"
        aria-live="polite"
      >
        Step {step} of {TOTAL_STEPS} · {STEP_TITLES[step - 1]}
      </p>
      <nav aria-label="Onboarding steps">
        <ol className="flex gap-[var(--space-2)] list-none m-0 p-0">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => {
            const stepNumber = i + 1;
            const isDone = stepNumber < step;
            const isCurrent = stepNumber === step;

            return (
              <li
                key={stepNumber}
                aria-current={isCurrent ? "step" : undefined}
                className="flex-1 flex flex-col items-center gap-[var(--space-1)]"
              >
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
                  {isDone ? "✓" : stepNumber}
                </span>
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
  );
}

function StepContent({ wizard }: { wizard: OnboardingWizardState }) {
  switch (wizard.step) {
    case 1:
      return (
        <StepLevel
          headingRef={wizard.headingRef}
          value={wizard.englishLevel}
          onChange={wizard.setEnglishLevel}
          error={wizard.error}
        />
      );
    case 2:
      return (
        <StepPlacement
          headingRef={wizard.headingRef}
          selfReportedLevel={wizard.englishLevel}
          questions={wizard.placementQuestions}
          answers={wizard.placementAnswers}
          onAnswer={wizard.handlePlacementAnswer}
          suggestedLevel={wizard.suggestedPlacementLevel}
          onAcceptSuggestion={wizard.handleAcceptSuggestion}
          onDismissSuggestion={wizard.handleDismissSuggestion}
          suggestionAccepted={wizard.suggestionAccepted}
        />
      );
    case 3:
      return (
        <StepTopics
          headingRef={wizard.headingRef}
          topics={wizard.topics}
          toggleTopic={wizard.toggleTopic}
        />
      );
    case 4:
      return (
        <StepAbout
          headingRef={wizard.headingRef}
          ageRange={wizard.ageRange}
          gender={wizard.gender}
          onAgeChange={wizard.setAgeRange}
          onGenderChange={wizard.setGender}
        />
      );
    case 5:
      return (
        <StepReview
          headingRef={wizard.headingRef}
          englishLevel={wizard.englishLevel}
          topics={wizard.topics}
          ageRange={wizard.ageRange}
          gender={wizard.gender}
          onJump={wizard.goToStep}
          error={wizard.error}
        />
      );
    default:
      return null;
  }
}

function FooterNav({ wizard }: { wizard: OnboardingWizardState }) {
  const canSkipStep = wizard.step === 2 || wizard.step === 3 || wizard.step === 4;

  return (
    <div
      className={cn(
        "flex items-center gap-[var(--space-3)] mt-[var(--space-2)]",
        wizard.step === 1 ? "justify-end" : "justify-between",
      )}
    >
      {wizard.step > 1 && (
        <Button
          variant="ghost"
          leadingIcon={<ArrowLeft size={16} aria-hidden />}
          onClick={wizard.goBack}
        >
          Back
        </Button>
      )}

      <div className="flex items-center gap-[var(--space-3)]">
        {canSkipStep && (
          <Button variant="ghost" onClick={wizard.skipStep}>
            {wizard.step === 2 ? "Skip – I know my level" : "Skip for now"}
          </Button>
        )}
        {wizard.step < TOTAL_STEPS && (
          <Button
            variant="primary"
            trailingIcon={<ArrowRight size={16} aria-hidden />}
            onClick={wizard.goNext}
            disabled={wizard.step === 1 && !wizard.englishLevel}
          >
            Next
          </Button>
        )}
        {wizard.step === TOTAL_STEPS && (
          <Button
            variant="primary"
            loading={wizard.submitting}
            onClick={wizard.handleFinish}
          >
            Finish setup
          </Button>
        )}
      </div>
    </div>
  );
}

export default function OnboardingForm({ defaults }: { defaults: Defaults }) {
  const wizard = useOnboardingWizard(defaults);

  return (
    <Card className="mt-[var(--space-6)] flex flex-col gap-[var(--space-5)]">
      <ProgressStepper step={wizard.step} />

      <div key={wizard.step} className="rw-step">
        <StepContent wizard={wizard} />
      </div>

      <FooterNav wizard={wizard} />
    </Card>
  );
}
