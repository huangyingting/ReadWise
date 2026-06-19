"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

/**
 * ArticleQuiz (M5 refactor)
 *
 * Stripped of its own open/close toggle. Fetches on first mount
 * (= first Quiz-tab activation). Inner radio/scoring UI unchanged.
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
  const hasFetched = useRef(false);

  // Fetch once on first mount (first Quiz-tab activation).
  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    void loadQuiz();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const score = useMemo(() => {
    if (!submitted) {
      return 0;
    }
    return questions.reduce(
      (total, q, i) => (answers[i] === q.correctIndex ? total + 1 : total),
      0,
    );
  }, [submitted, questions, answers]);

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

  function selectAnswer(questionIndex: number, optionIndex: number) {
    if (submitted) {
      return;
    }
    setAnswers((prev) => ({ ...prev, [questionIndex]: optionIndex }));
  }

  function handleSubmit() {
    setSubmitted(true);
  }

  function handleRetry() {
    setSubmitted(false);
    setAnswers({});
  }

  const allAnswered =
    questions.length > 0 &&
    questions.every((_, i) => answers[i] !== undefined);

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
          The comprehension quiz is unavailable right now. Please try again
          later.
        </p>
      ) : null}

      {!loading && loaded && !fallback && questions.length === 0 ? (
        <p className="muted">No quiz questions for this article.</p>
      ) : null}

      {questions.length > 0 ? (
        <>
          <ol className="quiz-list">
            {questions.map((q, qi) => (
              <li key={q.question} className="quiz-item">
                <p className="quiz-question">{q.question}</p>
                <ul className="quiz-options">
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
                      <li key={opt} className="quiz-option">
                        <label className={`quiz-option-label ${stateClass}`}>
                          <input
                            type="radio"
                            name={`quiz-${qi}`}
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
                      </li>
                    );
                  })}
                </ul>
                {submitted ? (
                  <p
                    className={`quiz-feedback ${
                      answers[qi] === q.correctIndex
                        ? "is-correct"
                        : "is-wrong"
                    }`}
                    role="status"
                  >
                    {answers[qi] === q.correctIndex
                      ? "Correct"
                      : "Incorrect"}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>

          {submitted ? (
            <div className="quiz-result">
              <p className="quiz-score" role="status">
                You scored {score} / {questions.length}
              </p>
              <button
                type="button"
                className="btn"
                onClick={handleRetry}
              >
                Try again
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-primary quiz-submit"
              onClick={handleSubmit}
              disabled={!allAnswered}
            >
              Check answers
            </button>
          )}
        </>
      ) : null}
    </div>
  );
}

