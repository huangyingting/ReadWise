"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { submitMutation, newClientMutationId } from "@/lib/offline/sync-runtime";

export type QuizQuestion = {
  question: string;
  options: string[];
  correctIndex: number;
};

export type AttemptItem = {
  id: string;
  correctCount: number;
  totalQuestions: number;
  scorePct: number;
  completedAt: string;
};

type QuizResponse = {
  articleId: string;
  questions: QuizQuestion[];
  fallback: boolean;
};

type HistoryResponse = {
  attempts: AttemptItem[];
  best: number | null;
  lastScore: number | null;
  attemptCount: number;
};

type AttemptResponse = {
  attempt: AttemptItem;
  best: number;
};

export type SavedNote = "idle" | "saving" | "saved" | "failed" | "queued";

export type UseArticleQuizPanelResult = {
  loading: boolean;
  loaded: boolean;
  error: string | null;
  fallback: boolean;
  questions: QuizQuestion[];
  answers: Record<number, number>;
  submitted: boolean;
  score: number;
  scorePct: number;
  allAnswered: boolean;
  attempts: AttemptItem[];
  best: number | null;
  bestAttemptId: string | null;
  savedNote: SavedNote;
  isNewBest: boolean;
  selectAnswer: (questionIndex: number, optionIndex: number) => void;
  handleSubmit: () => void;
  handleRetry: () => void;
};

/**
 * useArticleQuizPanel
 *
 * Data + interaction hook for the quiz study panel. Handles:
 *   - One-shot lazy fetch of quiz questions on first mount
 *   - Silent history fetch on first mount
 *   - Answer selection state
 *   - Check-answers submission with idempotency key
 *   - Offline queue fallback (RW-042)
 *   - Best-score tracking, saved note, retry/reset
 */
export function useArticleQuizPanel(
  articleId: string,
): UseArticleQuizPanelResult {
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);

  const [attempts, setAttempts] = useState<AttemptItem[]>([]);
  const [best, setBest] = useState<number | null>(null);
  const [savedNote, setSavedNote] = useState<SavedNote>("idle");
  const [isNewBest, setIsNewBest] = useState(false);

  const hasFetched = useRef(false);
  /** True after the attempt POST has fired for the current completion cycle. */
  const recordedRef = useRef(false);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    void loadQuiz();
    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const score = useMemo(() => {
    if (!submitted) return 0;
    return questions.reduce(
      (total, q, i) => (answers[i] === q.correctIndex ? total + 1 : total),
      0,
    );
  }, [submitted, questions, answers]);

  const bestAttemptId = useMemo(() => {
    if (best === null || attempts.length === 0) return null;
    for (let i = attempts.length - 1; i >= 0; i--) {
      if (attempts[i].scorePct === best) return attempts[i].id;
    }
    return null;
  }, [attempts, best]);

  async function loadQuiz() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reader/${articleId}/quiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? "Could not load quiz");
      }
      const data = (await res.json()) as QuizResponse;
      setQuestions(data.questions);
      setFallback(data.fallback);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load quiz");
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory() {
    try {
      const res = await fetch(`/api/reader/${articleId}/quiz/history`);
      if (!res.ok) return;
      const data = (await res.json()) as HistoryResponse;
      setAttempts(data.attempts);
      setBest(data.best);
    } catch {
      // silent — history is best-effort context; not required for grading
    }
  }

  const selectAnswer = useCallback(
    (questionIndex: number, optionIndex: number) => {
      if (submitted) return;
      setAnswers((prev) => ({ ...prev, [questionIndex]: optionIndex }));
    },
    [submitted],
  );

  function handleSubmit() {
    setSubmitted(true);

    if (recordedRef.current || questions.length === 0 || fallback) return;
    recordedRef.current = true;
    setSavedNote("saving");

    const priorBest = best;

    // Send selected answer indices — server grades authoritatively
    const submittedAnswers = questions.map((_, i) => ({
      index: i,
      selectedIndex: answers[i],
    }));

    const clientMutationId = newClientMutationId();
    const endpoint = `/api/reader/${articleId}/quiz/attempt`;
    const payload = { answers: submittedAnswers, clientMutationId };

    fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-mutation-id": clientMutationId,
      },
      body: JSON.stringify(payload),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((data: AttemptResponse) => {
        setSavedNote("saved");
        setAttempts((prev) => [data.attempt, ...prev]);
        setBest(data.best);
        setIsNewBest(priorBest === null || data.attempt.scorePct > priorBest);
      })
      .catch(() => {
        void submitMutation({
          type: "quiz.attempt",
          endpoint,
          method: "POST",
          body: payload,
          clientMutationId,
        }).then((res) => {
          setSavedNote(res.queued ? "queued" : "failed");
        });
      });
  }

  function handleRetry() {
    setSubmitted(false);
    setAnswers({});
    recordedRef.current = false;
    setSavedNote("idle");
    setIsNewBest(false);
  }

  const allAnswered =
    questions.length > 0 &&
    questions.every((_, i) => answers[i] !== undefined);

  const scorePct =
    submitted && questions.length > 0
      ? Math.round((score / questions.length) * 100)
      : 0;

  return {
    loading,
    loaded,
    error,
    fallback,
    questions,
    answers,
    submitted,
    score,
    scorePct,
    allAnswered,
    attempts,
    best,
    bestAttemptId,
    savedNote,
    isNewBest,
    selectAnswer,
    handleSubmit,
    handleRetry,
  };
}
