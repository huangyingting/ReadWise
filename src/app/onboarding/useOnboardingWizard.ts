"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/client-fetch";
import { ENGLISH_LEVELS, type EnglishLevel } from "@/lib/option-registries";
import {
  getPlacementQuestions,
  computePlacementScore,
  suggestLevel,
  type PlacementQuestion,
} from "@/lib/placement";
import { useMutation } from "@/hooks/useMutation";

export const TOTAL_STEPS = 5;

type WizardDefaults = {
  ageRange: string;
  gender: string;
  englishLevel: string;
  topics: string[];
};

export type OnboardingWizardState = {
  // Step navigation
  step: number;
  goNext: () => void;
  goBack: () => void;
  skipStep: () => void;
  goToStep: (s: number) => void;

  // Profile form state
  ageRange: string;
  setAgeRange: (v: string) => void;
  gender: string;
  setGender: (v: string) => void;
  englishLevel: string;
  setEnglishLevel: (v: string) => void;
  topics: string[];
  toggleTopic: (slug: string) => void;

  // Placement quiz state
  placementQuestions: PlacementQuestion[];
  placementAnswers: (number | null)[];
  handlePlacementAnswer: (qIdx: number, optIdx: number) => void;
  suggestedPlacementLevel: EnglishLevel | null;
  suggestionAccepted: boolean;
  handleAcceptSuggestion: () => void;
  handleDismissSuggestion: () => void;

  // Submit
  handleFinish: () => void;
  submitting: boolean;

  // Error (validation on step 1 or submission error from finish)
  error: string | null;

  // Focus ref for step headings (keyboard/AT support)
  headingRef: React.RefObject<HTMLHeadingElement | null>;
};

export function useOnboardingWizard(
  defaults: WizardDefaults,
): OnboardingWizardState {
  const router = useRouter();
  // useMutation handles busy state and submission error mapping
  const { busy: submitting, error: submitError, clearError: clearSubmitError, run } =
    useMutation("Network error. Please try again.");

  const [step, setStep] = useState(1);
  const [ageRange, setAgeRange] = useState(defaults.ageRange);
  const [gender, setGender] = useState(defaults.gender);
  const [englishLevel, setEnglishLevel] = useState(defaults.englishLevel);
  const [topics, setTopics] = useState<string[]>(defaults.topics);

  // Synchronous validation error (step 1 level not selected)
  const [validationError, setValidationError] = useState<string | null>(null);

  // Placement quiz state
  const [placementAnswers, setPlacementAnswers] = useState<(number | null)[]>([
    null,
    null,
    null,
  ]);
  const [suggestionAccepted, setSuggestionAccepted] = useState(false);

  const headingRef = useRef<HTMLHeadingElement>(null);

  // Derived placement values
  const placementQuestions: PlacementQuestion[] =
    englishLevel && ENGLISH_LEVELS.includes(englishLevel as EnglishLevel)
      ? getPlacementQuestions(englishLevel as EnglishLevel)
      : [];

  const answeredCount = placementAnswers.filter((a) => a !== null).length;
  const placementScore = computePlacementScore(placementAnswers, placementQuestions);
  const suggestedPlacementLevel: EnglishLevel | null =
    answeredCount === placementQuestions.length &&
    englishLevel &&
    ENGLISH_LEVELS.includes(englishLevel as EnglishLevel)
      ? suggestLevel(
          placementScore,
          placementQuestions.length,
          englishLevel as EnglishLevel,
        )
      : null;

  // Focus step heading on step change for AT announcement + keyboard reset
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const toggleTopic = useCallback((slug: string) => {
    setTopics((prev) =>
      prev.includes(slug) ? prev.filter((t) => t !== slug) : [...prev, slug],
    );
  }, []);

  const handlePlacementAnswer = useCallback(
    (qIdx: number, optIdx: number) => {
      setPlacementAnswers((prev) => {
        const next = [...prev];
        next[qIdx] = optIdx;
        return next;
      });
    },
    [],
  );

  const handleAcceptSuggestion = useCallback(() => {
    if (suggestedPlacementLevel) {
      setEnglishLevel(suggestedPlacementLevel);
      setSuggestionAccepted(true);
    }
  }, [suggestedPlacementLevel]);

  const handleDismissSuggestion = useCallback(() => {
    setSuggestionAccepted(true);
  }, []);

  const goNext = useCallback(() => {
    if (step === 1 && !englishLevel) {
      setValidationError("Please select your English level.");
      return;
    }
    setValidationError(null);
    clearSubmitError();
    setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  }, [step, englishLevel, clearSubmitError]);

  const goBack = useCallback(() => {
    setValidationError(null);
    clearSubmitError();
    setStep((s) => Math.max(s - 1, 1));
  }, [clearSubmitError]);

  const skipStep = useCallback(() => {
    setValidationError(null);
    clearSubmitError();
    setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  }, [clearSubmitError]);

  const goToStep = useCallback(
    (s: number) => {
      setValidationError(null);
      clearSubmitError();
      setStep(s);
    },
    [clearSubmitError],
  );

  const handleFinish = useCallback(() => {
    run(async () => {
      await postJson("/api/onboarding", {
        ageRange,
        gender,
        englishLevel,
        topics,
      });
      router.push("/welcome");
      router.refresh();
    });
  }, [run, ageRange, gender, englishLevel, topics, router]);

  // Combined error: validation error takes precedence over submit error
  const error = validationError ?? submitError;

  return {
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
    setEnglishLevel: (v: string) => {
      setEnglishLevel(v);
      setValidationError(null);
      // Reset placement state when the self-reported level changes
      setPlacementAnswers([null, null, null]);
      setSuggestionAccepted(false);
    },
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
  };
}
