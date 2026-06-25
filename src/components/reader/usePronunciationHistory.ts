"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type {
  PronunciationAttemptSummary,
  SentenceHistory,
} from "@/components/reader/pronunciationTypes";

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
    if (allAttempts.length === 0 || !currentSentence) return { best: null, last: null };
    const matching = allAttempts.filter(
      (a) => a.referenceText.trim() === currentSentence.trim(),
    );
    if (matching.length === 0) return { best: null, last: null };
    return {
      last: matching[0].pronScore,
      best: Math.max(...matching.map((a) => a.pronScore)),
    };
  }, [allAttempts, currentSentence]);

  return { allAttempts, sentenceHistory, loadHistory, addAttempt };
}
