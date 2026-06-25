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
      const res = await fetch("/api/pronunciation/attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referenceText,
          accuracyScore: assessment.accuracyScore,
          fluencyScore: assessment.fluencyScore,
          completenessScore: assessment.completenessScore,
          pronScore: assessment.pronScore,
          articleId,
        }),
      });
      if (!res.ok) throw new Error("save failed");

      const data = (await res.json()) as { attempt: PronunciationAttemptSummary };
      setSavedNote("saved");
      onSaved(data.attempt);

      if (priorBest === null || assessment.pronScore > priorBest) {
        setIsNewBest(true);
      }
    } catch {
      setSavedNote("failed");
    }
  }, []);

  return { savedNote, isNewBest, resetPersistence, persistAttempt };
}
