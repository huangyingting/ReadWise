"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Star } from "lucide-react";
import { Button } from "@/components/ui/Button";
import AiBadge from "@/components/AiBadge";

type QuizQuestion = {
  question: string;
  options: string[];
  correctIndex: number;
};

type QuizResponse = {
  articleId: string;
  questions: QuizQuestion[];
  fallback: boolean;
};

// M14 attempt types (completedAt is an ISO string after JSON serialization)
type AttemptItem = {
  id: string;
  correctCount: number;
  totalQuestions: number;
  scorePct: number;
  completedAt: string;
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

type SavedNote = "idle" | "saving" | "saved" | "failed";

/** Formats a Date/ISO string into a human-readable relative time. */
function relativeDate(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay} days ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * ArticleQuiz (M5 refactor, M14 attempt recording + history)
 *
 * Stripped of its own open/close toggle. Fetches on first mount
 * (= first Quiz-tab activation). Inner radio/scoring UI unchanged.
 *
 * M14 additions:
 * - On first mount, also fetches GET /quiz/history (silent on failure).
 * - On "Check answers", fires POST /quiz/attempt EXACTLY ONCE per completion
 *   cycle (guarded by recordedRef). Try again resets recordedRef for the
 *   next completion.
 * - Renders enriched .quiz-result: score + teal %, best pill, saved note,
 *   compact history list (≤5), Try again.
 *
 * Props:
 *   articleId — the article to generate quiz for
 *   active    — true when the Quiz tab is the currently visible panel
 */
export default function ArticleQuiz({
  articleId,
}: {
  articleId: string;
  active: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);

  // M14 state
  const [attempts, setAttempts] = useState<AttemptItem[]>([]);
  const [best, setBest] = useState<number | null>(null);
  const [savedNote, setSavedNote] = useState<SavedNote>("idle");
  const [isNewBest, setIsNewBest] = useState(false);

  const hasFetched = useRef(false);
  /** True after the attempt POST has fired for the current completion cycle. */
  const recordedRef = useRef(false);

  // Fetch quiz + history once on first mount (first Quiz-tab activation).
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

  /** The best-attempt id (earliest chronologically that ties the best score). */
  const bestAttemptId = useMemo(() => {
    if (best === null || attempts.length === 0) return null;
    // attempts is newest-first; iterate from oldest (end) to find earliest best
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

  /** Fetches per-article history silently; failure just omits the history block. */
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

  function selectAnswer(questionIndex: number, optionIndex: number) {
    if (submitted) return;
    setAnswers((prev) => ({ ...prev, [questionIndex]: optionIndex }));
  }

  function handleSubmit() {
    setSubmitted(true);

    // Guard: fire exactly once per completion cycle; never on fallback or empty quiz
    if (recordedRef.current || questions.length === 0 || fallback) return;
    recordedRef.current = true;
    setSavedNote("saving");

    const priorBest = best; // capture before async update

    // Send the user's SELECTED answer indices — the server grades against the
    // cached correctIndex and derives the authoritative score. The client-side
    // `correctCount`/feedback above is for instant display only.
    const submittedAnswers = questions.map((_, i) => ({
      index: i,
      selectedIndex: answers[i],
    }));

    fetch(`/api/reader/${articleId}/quiz/attempt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: submittedAnswers }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((data: AttemptResponse) => {
        setSavedNote("saved");
        setAttempts((prev) => [data.attempt, ...prev]);
        setBest(data.best);
        setIsNewBest(priorBest === null || data.attempt.scorePct > priorBest);
      })
      .catch(() => {
        setSavedNote("failed");
      });
  }

  function handleRetry() {
    setSubmitted(false);
    setAnswers({});
    recordedRef.current = false; // reset so next completion records a new attempt
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

  return (
    <div className="quiz-panel">
      {loading ? <p className="muted">Generating questions…</p> : null}

      {error ? (
        <p className="quiz-error" role="alert">
          {error}
        </p>
      ) : null}

      {!loading && loaded && fallback ? (
        <p className="muted">
          AI feature unavailable — quiz generation is not available right now.
          Please try again later.
        </p>
      ) : null}

      {!loading && loaded && !fallback && questions.length === 0 ? (
        <p className="muted">No quiz questions for this article.</p>
      ) : null}

      {questions.length > 0 ? (
        <>
          <div style={{ marginBottom: "var(--space-3)" }}>
            <AiBadge />
          </div>
          <ol className="quiz-list">
            {questions.map((q, qi) => (
              <li key={q.question} className="quiz-item">
                <p id={`quiz-question-${qi}`} className="quiz-question">{q.question}</p>
                <div
                  role="radiogroup"
                  aria-labelledby={`quiz-question-${qi}`}
                  className="quiz-options"
                >
                  {q.options.map((opt, oi) => {
                    const selected = answers[qi] === oi;
                    const isCorrect = oi === q.correctIndex;
                    let stateClass = "";
                    if (submitted) {
                      if (isCorrect) {
                        stateClass = "is-correct";
                      } else if (selected) {
                        stateClass = "is-wrong";
                      }
                    } else if (selected) {
                      stateClass = "is-selected";
                    }
                    return (
                      <div key={opt} className="quiz-option">
                        <label
                          htmlFor={`quiz-${qi}-${oi}`}
                          className={`quiz-option-label ${stateClass}`}
                        >
                          <input
                            type="radio"
                            id={`quiz-${qi}-${oi}`}
                            name={`quiz-${qi}`}
                            value={String(oi)}
                            checked={selected}
                            disabled={submitted}
                            onChange={() => selectAnswer(qi, oi)}
                          />
                          <span>{opt}</span>
                          {submitted && isCorrect ? (
                            <span className="quiz-mark" aria-hidden="true">
                              ✓
                            </span>
                          ) : null}
                          {submitted && selected && !isCorrect ? (
                            <span className="quiz-mark" aria-hidden="true">
                              ✗
                            </span>
                          ) : null}
                        </label>
                      </div>
                    );
                  })}
                </div>
                {submitted ? (
                  <p
                    className={`quiz-feedback ${
                      answers[qi] === q.correctIndex ? "is-correct" : "is-wrong"
                    }`}
                    role="status"
                  >
                    {answers[qi] === q.correctIndex ? "Correct" : "Incorrect"}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>

          {submitted ? (
            <div className="quiz-result">
              <div className="quiz-result-body">
                {/* Score headline + best pill */}
                <div className="quiz-result-header">
                  <p className="quiz-result-score" role="status">
                    You scored {score} / {questions.length}{" "}
                    <span aria-hidden>·</span>{" "}
                    <span className="quiz-score-pct">{scorePct}%</span>
                  </p>
                  {best !== null ? (
                    <span
                      className={`quiz-best${isNewBest ? " quiz-best-new" : ""}`}
                    >
                      <Star size={14} aria-hidden />
                      Best {best}%
                      {isNewBest ? (
                        <span className="quiz-best-new-label"> New best!</span>
                      ) : null}
                    </span>
                  ) : null}
                </div>

                {/* Saved note — always rendered (reserved height avoids layout shift) */}
                <p className="quiz-saved-note" aria-live="polite">
                  {savedNote === "saved" ? (
                    <>
                      <Check size={13} aria-hidden />
                      {" "}Attempt saved
                    </>
                  ) : savedNote === "failed" ? (
                    "Couldn't save this attempt"
                  ) : null}
                </p>

                {/* Recent attempts history — up to 5, newest-first */}
                {attempts.length > 0 ? (
                  <div className="quiz-history">
                    <p className="quiz-history-label">Recent attempts</p>
                    <ul className="quiz-history-list">
                      {attempts.slice(0, 5).map((a) => {
                        const isBestRow = a.id === bestAttemptId;
                        return (
                          <li
                            key={a.id}
                            className={`quiz-history-item${isBestRow ? " is-best" : ""}`}
                          >
                            <span className="quiz-history-date">
                              {relativeDate(a.completedAt)}
                            </span>
                            <span
                              className="quiz-attempt-bar"
                              aria-hidden
                            >
                              <span
                                className="quiz-attempt-bar-fill"
                                style={{ width: `${a.scorePct}%` }}
                              />
                            </span>
                            <span className="quiz-history-pct">
                              {a.scorePct}%
                            </span>
                            {isBestRow ? (
                              <span className="quiz-history-best-tag">
                                Best
                              </span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}

                {/* Try again — indigo, unchanged */}
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRetry}
                >
                  Try again
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={!allAnswered}
            >
              Check answers
            </Button>
          )}
        </>
      ) : null}
    </div>
  );
}

