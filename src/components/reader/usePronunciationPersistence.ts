"use client";

import { useCallback, useRef, useState } from "react";
import type {
  AssessResult,
  PronunciationAttemptSummary,
  SavedNote,
} from "@/components/reader/pronunciationTypes";

type PersistInput = {
  articleId: string;
  assessment: AssessResult;
  referenceText: string;
  priorBest: number | null;
  onSaved: (attempt: PronunciationAttemptSummary) => void;
};

function buildAttemptPayload({
  articleId,
  assessment,
  referenceText,
}: Pick<PersistInput, "articleId" | "assessment" | "referenceText">) {
  return {
    referenceText,
    accuracyScore: assessment.accuracyScore,
    fluencyScore: assessment.fluencyScore,
    completenessScore: assessment.completenessScore,
    pronScore: assessment.pronScore,
    articleId,
  };
}

function isNewBestScore(score: number, priorBest: number | null) {
  return priorBest === null || score > priorBest;
}

async function savePronunciationAttempt(
  payload: ReturnType<typeof buildAttemptPayload>,
) {
  const res = await fetch("/api/pronunciation/attempt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("save failed");

  const data = (await res.json()) as { attempt: PronunciationAttemptSummary };
  return data.attempt;
}

export function usePronunciationPersistence() {
  const recordedRef = useRef(false);
  const [savedNote, setSavedNote] = useState<SavedNote>("idle");
  const [isNewBest, setIsNewBest] = useState(false);

  const resetPersistence = useCallback(() => {
    setSavedNote("idle");
    setIsNewBest(false);
    recordedRef.current = false;
  }, []);

  const persistAttempt = useCallback(async ({
    articleId,
    assessment,
    referenceText,
    priorBest,
    onSaved,
  }: PersistInput) => {
    if (recordedRef.current) return;
    recordedRef.current = true;
    setSavedNote("saving");

    try {
      const attempt = await savePronunciationAttempt(
        buildAttemptPayload({
          articleId,
          assessment,
          referenceText,
        }),
      );

      setSavedNote("saved");
      onSaved(attempt);

      if (isNewBestScore(assessment.pronScore, priorBest)) {
        setIsNewBest(true);
      }
    } catch {
      setSavedNote("failed");
    }
  }, []);

  return { savedNote, isNewBest, resetPersistence, persistAttempt };
}
