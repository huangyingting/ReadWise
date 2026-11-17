"use client";

/**
 * Teacher review of one written response (#1305): score each rubric
 * dimension (1–4), leave feedback, then Grade or Return for revision.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientErrorMessage, postJson } from "@/lib/client-fetch";
import {
  RUBRIC_MAX_SCORE,
  RUBRIC_MIN_SCORE,
  WRITE_RUBRIC,
  rubricTotal,
  type RubricDimension,
  type RubricScores,
} from "@/lib/classroom/writing-rubric";
import { Button, Field, PanelError, Select, Textarea } from "@/components/ui";

const SCORE_OPTIONS = Array.from(
  { length: RUBRIC_MAX_SCORE - RUBRIC_MIN_SCORE + 1 },
  (_, index) => RUBRIC_MIN_SCORE + index,
);

interface WriteReviewFormProps {
  submissionId: string;
  studentLabel: string;
  initialScores: RubricScores;
  initialFeedback: string | null;
}

export default function WriteReviewForm({ submissionId, studentLabel, initialScores, initialFeedback }: WriteReviewFormProps) {
  const router = useRouter();
  const [scores, setScores] = useState<RubricScores>(initialScores);
  const [feedback, setFeedback] = useState(initialFeedback ?? "");
  const [pending, setPending] = useState<"grade" | "return" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { total, max } = rubricTotal(scores);
  const complete = WRITE_RUBRIC.every(({ key }) => scores[key] !== undefined);

  function setScore(key: RubricDimension, value: string) {
    setScores((current) => {
      const next = { ...current };
      if (value) next[key] = Number(value);
      else delete next[key];
      return next;
    });
  }

  async function review(action: "grade" | "return") {
    setPending(action);
    setError(null);
    setMessage(null);
    try {
      await postJson(`/api/write-submissions/${encodeURIComponent(submissionId)}/review`, {
        action,
        rubricScores: scores,
        feedback,
      });
      setMessage(action === "grade" ? "Graded." : "Returned for revision.");
      router.refresh();
    } catch (err) {
      setError(clientErrorMessage(err, "Couldn’t save the review."));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-[var(--space-3)]" aria-label={`Review for ${studentLabel}`} role="group">
      <div className="grid gap-[var(--space-3)] sm:grid-cols-2">
        {WRITE_RUBRIC.map(({ key, label }) => (
          <Field key={key} label={label}>
            <Select value={scores[key] === undefined ? "" : String(scores[key])} onChange={(event) => setScore(key, event.target.value)}>
              <option value="">Not scored</option>
              {SCORE_OPTIONS.map((score) => (
                <option key={score} value={String(score)}>
                  {score} / {RUBRIC_MAX_SCORE}
                </option>
              ))}
            </Select>
          </Field>
        ))}
      </div>
      <Field label="Feedback" hint="Students see this with their scores.">
        <Textarea value={feedback} rows={3} maxLength={4000} onChange={(event) => setFeedback(event.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <Button
          type="button"
          size="sm"
          loading={pending === "grade"}
          disabled={pending !== null || !complete}
          onClick={() => void review("grade")}
        >
          Grade ({total}/{max})
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          loading={pending === "return"}
          disabled={pending !== null}
          onClick={() => void review("return")}
        >
          Return for revision
        </Button>
        {!complete ? (
          <span className="text-[length:var(--type-label)] text-text-muted">Score every dimension to grade.</span>
        ) : null}
      </div>
      {message ? (
        <p role="status" className="m-0 text-[length:var(--type-ui)] text-text-muted">
          {message}
        </p>
      ) : null}
      {error ? <PanelError message={error} /> : null}
    </div>
  );
}
