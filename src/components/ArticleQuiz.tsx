"use client";

import { Check, Star } from "lucide-react";
import { Button } from "@/components/ui/Button";
import AiBadge from "@/components/AiBadge";
import { formatRelativeTime } from "@/lib/display-format";
import {
  useArticleQuizPanel,
  type QuizQuestion,
  type AttemptItem,
  type SavedNote,
} from "@/components/reader/study/useArticleQuizPanel";

/**
 * ArticleQuiz (M5 refactor, M14 attempt recording + history, REF-062 split)
 *
 * Thin composition: data/interaction state lives in useArticleQuizPanel;
 * this file owns only the rendered output.
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
  const panel = useArticleQuizPanel(articleId);

  return (
    <div className="quiz-panel">
      {panel.loading ? <p className="muted">Generating questions…</p> : null}

      {panel.error ? (
        <p className="quiz-error" role="alert">
          {panel.error}
        </p>
      ) : null}

      {!panel.loading && panel.loaded && panel.fallback ? (
        <p className="muted">
          AI feature unavailable — quiz generation is not available right now.
          Please try again later.
        </p>
      ) : null}

      {!panel.loading && panel.loaded && !panel.fallback && panel.questions.length === 0 ? (
        <p className="muted">No quiz questions for this article.</p>
      ) : null}

      {panel.questions.length > 0 ? (
        <>
          <div style={{ marginBottom: "var(--space-3)" }}>
            <AiBadge />
          </div>
          <QuizQuestionList
            questions={panel.questions}
            answers={panel.answers}
            submitted={panel.submitted}
            onSelect={panel.selectAnswer}
          />

          {panel.submitted ? (
            <QuizResult
              score={panel.score}
              total={panel.questions.length}
              scorePct={panel.scorePct}
              best={panel.best}
              isNewBest={panel.isNewBest}
              savedNote={panel.savedNote}
              attempts={panel.attempts}
              bestAttemptId={panel.bestAttemptId}
              onRetry={panel.handleRetry}
            />
          ) : (
            <Button
              type="button"
              onClick={panel.handleSubmit}
              disabled={!panel.allAnswered}
            >
              Check answers
            </Button>
          )}
        </>
      ) : null}
    </div>
  );
}

// ─── Presentational sub-components ────────────────────────────────────────────

function QuizQuestionList({
  questions,
  answers,
  submitted,
  onSelect,
}: {
  questions: QuizQuestion[];
  answers: Record<number, number>;
  submitted: boolean;
  onSelect: (qi: number, oi: number) => void;
}) {
  return (
    <ol className="quiz-list">
      {questions.map((q, qi) => (
        <li key={q.question} className="quiz-item">
          <p id={`quiz-question-${qi}`} className="quiz-question">
            {q.question}
          </p>
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
                      onChange={() => onSelect(qi, oi)}
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
  );
}

function QuizResult({
  score,
  total,
  scorePct,
  best,
  isNewBest,
  savedNote,
  attempts,
  bestAttemptId,
  onRetry,
}: {
  score: number;
  total: number;
  scorePct: number;
  best: number | null;
  isNewBest: boolean;
  savedNote: SavedNote;
  attempts: AttemptItem[];
  bestAttemptId: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="quiz-result">
      <div className="quiz-result-body">
        {/* Score headline + best pill */}
        <div className="quiz-result-header">
          <p className="quiz-result-score" role="status">
            You scored {score} / {total} <span aria-hidden>·</span>{" "}
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

        {/* Saved note */}
        <p className="quiz-saved-note" aria-live="polite">
          {savedNote === "saved" ? (
            <>
              <Check size={13} aria-hidden />
              {" "}Attempt saved
            </>
          ) : savedNote === "queued" ? (
            "Saved offline — will sync when you reconnect"
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
                      {formatRelativeTime(a.completedAt)}
                    </span>
                    <span className="quiz-attempt-bar" aria-hidden>
                      <span
                        className="quiz-attempt-bar-fill"
                        style={{ width: `${a.scorePct}%` }}
                      />
                    </span>
                    <span className="quiz-history-pct">{a.scorePct}%</span>
                    {isBestRow ? (
                      <span className="quiz-history-best-tag">Best</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <Button type="button" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}

