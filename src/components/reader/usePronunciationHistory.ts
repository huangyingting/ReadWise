"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type {
  PronunciationAttemptSummary,
  SentenceHistory,
} from "@/components/reader/pronunciationTypes";

const EMPTY_SENTENCE_HISTORY: SentenceHistory = { best: null, last: null };

export function usePronunciationHistory(currentSentence: string) {
  const [allAttempts, setAllAttempts] = useState<PronunciationAttemptSummary[]>([]);
  const historyLoaded = useRef(false);

  const loadHistory = useCallback(async () => {
    if (historyLoaded.current) return;
    historyLoaded.current = true;
    try {
      const res = await fetch("/api/pronunciation/history?limit=100");
      if (!res.ok) return;
      const data = (await res.json()) as { attempts: PronunciationAttemptSummary[] };
      setAllAttempts(data.attempts ?? []);
    } catch {
      // Silent — history is best-effort context.
    }
  }, []);

  const addAttempt = useCallback((attempt: PronunciationAttemptSummary) => {
    setAllAttempts((prev) => [attempt, ...prev]);
  }, []);

  const sentenceHistory = useMemo<SentenceHistory>(() => {
    if (allAttempts.length === 0 || !currentSentence) return EMPTY_SENTENCE_HISTORY;

    const normalizedSentence = currentSentence.trim();
    let last: number | null = null;
    let best: number | null = null;

    for (const attempt of allAttempts) {
      if (attempt.referenceText.trim() !== normalizedSentence) continue;
      last ??= attempt.pronScore;
      best = best === null ? attempt.pronScore : Math.max(best, attempt.pronScore);
    }

    return best === null ? EMPTY_SENTENCE_HISTORY : { best, last };
  }, [allAttempts, currentSentence]);

  return { allAttempts, sentenceHistory, loadHistory, addAttempt };
}
