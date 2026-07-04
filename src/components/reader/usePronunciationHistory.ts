"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type {
  PronunciationAttemptSummary,
  SentenceTrend,
  SentenceHistory,
} from "@/components/reader/pronunciationTypes";

const EMPTY_SENTENCE_HISTORY: SentenceHistory = {
  best: null,
  last: null,
  average: null,
  trendDelta: null,
  attempts: 0,
};
const WEAK_SENTENCE_SCORE = 70;

type WeakSentence = SentenceTrend & { index: number };

function scoreAverage(scores: number[]): number | null {
  if (scores.length === 0) return null;
  return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

function trendKey(articleId: string | null | undefined, referenceText: string): string {
  return `${articleId ?? "freeform"}:${referenceText.trim()}`;
}

function buildTrend(
  attempts: PronunciationAttemptSummary[],
  articleId: string | null,
  referenceText: string,
): SentenceTrend | null {
  const rows = attempts
    .filter(
      (attempt) =>
        (attempt.articleId ?? null) === articleId &&
        attempt.referenceText.trim() === referenceText.trim(),
    )
    .slice()
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  if (rows.length === 0) return null;

  const scores = rows.map((row) => row.pronScore);
  const latest = rows[rows.length - 1];
  const firstScore = scores[0];
  const latestScore = latest.pronScore;
  return {
    key: trendKey(articleId, referenceText),
    articleId,
    referenceText,
    attempts: rows.length,
    firstScore,
    latestScore,
    bestScore: Math.max(...scores),
    averageScore: scoreAverage(scores) ?? latestScore,
    trendDelta: latestScore - firstScore,
    lastPracticedAt: latest.createdAt,
    scores,
  };
}

export function usePronunciationHistory(
  currentSentence: string,
  articleId?: string,
  sentences: string[] = [],
) {
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

  const sentenceTrend = useMemo<SentenceTrend | null>(() => {
    if (allAttempts.length === 0 || !currentSentence) return null;
    return buildTrend(allAttempts, articleId ?? null, currentSentence);
  }, [allAttempts, articleId, currentSentence]);

  const sentenceHistory = useMemo<SentenceHistory>(() => {
    if (!sentenceTrend) return EMPTY_SENTENCE_HISTORY;
    return {
      best: sentenceTrend.bestScore,
      last: sentenceTrend.latestScore,
      average: sentenceTrend.averageScore,
      trendDelta: sentenceTrend.trendDelta,
      attempts: sentenceTrend.attempts,
    };
  }, [sentenceTrend]);

  const weakSentences = useMemo<WeakSentence[]>(() => {
    if (allAttempts.length === 0 || sentences.length === 0) return [];

    return sentences
      .map((sentence, index) => {
        const trend = buildTrend(allAttempts, articleId ?? null, sentence);
        return trend ? { ...trend, index } : null;
      })
      .filter((trend): trend is WeakSentence => {
        if (!trend) return false;
        return trend.latestScore < WEAK_SENTENCE_SCORE || trend.averageScore < WEAK_SENTENCE_SCORE;
      })
      .sort((a, b) => a.latestScore - b.latestScore || b.attempts - a.attempts)
      .slice(0, 5);
  }, [allAttempts, articleId, sentences]);

  return { allAttempts, sentenceHistory, sentenceTrend, weakSentences, loadHistory, addAttempt };
}
