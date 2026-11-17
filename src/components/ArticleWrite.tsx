"use client";

/**
 * Reader "Write" panel (#1305): a constructed response to the article's Write
 * Prompt. Learners pick a classroom assignment of this article or write
 * independently (private), and drafts autosave while they type. Submitted
 * assignment work is read-only until the teacher grades it or returns it for
 * revision; returned work shows the rubric and feedback and can be
 * resubmitted.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiResponseError, clientErrorMessage, getJson, postJson, putJson } from "@/lib/client-fetch";
import {
  WRITE_BODY_MAX_LENGTH,
  WRITE_RUBRIC,
  WRITE_STATUS_LABELS,
  countWords,
  rubricTotal,
  type RubricScores,
  type WriteStatus,
} from "@/lib/classroom/writing-rubric";
import { Badge, Button, Field, PanelError, Select, Textarea } from "@/components/ui";

const AUTOSAVE_DELAY_MS = 1200;
const INDEPENDENT = "";

type Submission = {
  id: string;
  status: WriteStatus;
  body: string;
  wordCount: number;
  rubricScores: RubricScores;
  teacherFeedback: string | null;
  revisionCount: number;
};

type WriteContextResponse = {
  assignments: Array<{ id: string; classroomName: string; prompt: string }>;
  prompt: string;
  submission: Submission | null;
};

type SaveState = "idle" | "saving" | "saved" | "error";

function contextUrl(articleId: string, assignmentId: string) {
  const base = `/api/reader/${encodeURIComponent(articleId)}/write`;
  return assignmentId ? `${base}?assignmentId=${encodeURIComponent(assignmentId)}` : base;
}

function RubricSummary({ scores, feedback }: { scores: RubricScores; feedback: string | null }) {
  const scored = WRITE_RUBRIC.filter(({ key }) => scores[key] !== undefined);
  const { total, max } = rubricTotal(scores);
  return (
    <div className="flex flex-col gap-[var(--space-2)]">
      {scored.length > 0 ? (
        <ul aria-label="Rubric scores" className="m-0 flex flex-wrap gap-[var(--space-2)] p-0">
          {scored.map(({ key, label }) => (
            <li key={key} className="list-none">
              <Badge variant="neutral">
                {label}: {scores[key]}
              </Badge>
            </li>
          ))}
          <li className="list-none">
            <Badge variant="primary">
              Total {total}/{max}
            </Badge>
          </li>
        </ul>
      ) : null}
      {feedback ? <p className="m-0 whitespace-pre-line text-[length:var(--type-ui)] text-text">{feedback}</p> : null}
    </div>
  );
}

export default function ArticleWrite({ articleId }: { articleId: string }) {
  const [scope, setScope] = useState<string | null>(null);
  const [context, setContext] = useState<WriteContextResponse | null>(null);
  const [body, setBody] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedBody = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Scope whose context is loaded, so settling the default doesn't refetch it. */
  const loadedScope = useRef<string | null>(null);

  const load = useCallback(
    async (nextScope: string | null) => {
      setError(null);
      try {
        const data = await getJson<WriteContextResponse>(contextUrl(articleId, nextScope ?? INDEPENDENT));
        // Default to the first assignment of this article, if any.
        if (nextScope === null && data.assignments.length > 0) {
          setScope(data.assignments[0]!.id);
          return;
        }
        loadedScope.current = nextScope ?? INDEPENDENT;
        setScope(loadedScope.current);
        setContext(data);
        setBody(data.submission?.body ?? "");
        savedBody.current = data.submission?.body ?? "";
        setSaveState("idle");
      } catch (err) {
        setError(clientErrorMessage(err, "Couldn’t load the write prompt."));
      }
    },
    [articleId],
  );

  useEffect(() => {
    if (scope !== null && scope === loadedScope.current) return;
    void load(scope);
    // Reload only when the chosen scope changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const status = context?.submission?.status ?? "DRAFT";
  const independent = scope === INDEPENDENT;
  const editable = independent || status === "DRAFT" || status === "NEEDS_REVISION";

  const save = useCallback(
    async (text: string) => {
      if (scope === null) return;
      setSaveState("saving");
      try {
        const res = await putJson<{ submission: Submission }>(contextUrl(articleId, ""), {
          assignmentId: scope || null,
          body: text,
        });
        savedBody.current = text;
        setContext((current) => (current ? { ...current, submission: res.submission } : current));
        setSaveState("saved");
      } catch (err) {
        setSaveState("error");
        setError(clientErrorMessage(err, "Couldn’t save your draft."));
      }
    },
    [articleId, scope],
  );

  useEffect(() => {
    if (!editable || body === savedBody.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(body), AUTOSAVE_DELAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [body, editable, save]);

  async function submit() {
    if (scope === null) return;
    if (timer.current) clearTimeout(timer.current);
    setSubmitting(true);
    setError(null);
    try {
      const res = await postJson<{ submission: Submission }>(`${contextUrl(articleId, "")}/submit`, {
        assignmentId: scope || null,
        body,
      });
      savedBody.current = body;
      setContext((current) => (current ? { ...current, submission: res.submission } : current));
      setSaveState("idle");
    } catch (err) {
      setError(
        err instanceof ApiResponseError ? err.message : clientErrorMessage(err, "Couldn’t submit your response."),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!context) {
    return error ? <PanelError message={error} /> : <p className="m-0 text-[length:var(--type-ui)] text-text-muted">Loading…</p>;
  }

  const words = countWords(body);
  const submission = context.submission;

  return (
    <div className="flex flex-col gap-[var(--space-4)]">
      {context.assignments.length > 0 ? (
        <Field label="Writing for">
          <Select value={scope ?? INDEPENDENT} onChange={(event) => setScope(event.target.value)}>
            {context.assignments.map((assignment) => (
              <option key={assignment.id} value={assignment.id}>
                {assignment.classroomName} (assignment)
              </option>
            ))}
            <option value={INDEPENDENT}>Just me (private)</option>
          </Select>
        </Field>
      ) : null}

      <section aria-labelledby="write-prompt-heading" className="flex flex-col gap-[var(--space-2)]">
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          <h3 id="write-prompt-heading" className="m-0 text-[length:var(--type-section-title-compact)] font-semibold text-text">
            Write prompt
          </h3>
          {submission ? (
            <Badge
              variant={status === "GRADED" ? "success" : status === "NEEDS_REVISION" ? "warning" : "neutral"}
            >
              {WRITE_STATUS_LABELS[status]}
            </Badge>
          ) : null}
        </div>
        <p className="m-0 text-[length:var(--type-body)] text-text">{context.prompt}</p>
        {independent ? (
          <p className="m-0 text-[length:var(--type-label)] text-text-muted">Only you can see independent writing.</p>
        ) : null}
      </section>

      {submission && (status === "NEEDS_REVISION" || status === "GRADED") && !independent ? (
        <section
          aria-label={status === "GRADED" ? "Teacher grade" : "Revision requested"}
          className="flex flex-col gap-[var(--space-2)] rounded-[var(--radius-md)] border border-border p-[var(--space-3)]"
        >
          <p className="m-0 text-[length:var(--type-ui)] font-semibold text-text">
            {status === "GRADED" ? "Your teacher graded this response." : "Your teacher asked you to revise this response."}
          </p>
          <RubricSummary scores={submission.rubricScores} feedback={submission.teacherFeedback} />
        </section>
      ) : null}

      <Field
        label="Your response"
        hint={
          editable
            ? "Your draft saves automatically. Keep the article open on the side to quote it."
            : "Submitted — your teacher will review it."
        }
      >
        <Textarea
          value={body}
          rows={10}
          maxLength={WRITE_BODY_MAX_LENGTH}
          readOnly={!editable}
          onChange={(event) => setBody(event.target.value)}
        />
      </Field>

      <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
        <p role="status" className="m-0 text-[length:var(--type-label)] text-text-muted">
          {words} {words === 1 ? "word" : "words"}
          {saveState === "saving" ? " · Saving…" : saveState === "saved" ? " · Draft saved" : ""}
        </p>
        {editable ? (
          <Button type="button" loading={submitting} disabled={submitting || words === 0} onClick={() => void submit()}>
            {status === "NEEDS_REVISION" ? "Resubmit" : "Submit"}
          </Button>
        ) : null}
      </div>
      {error ? <PanelError message={error} /> : null}
    </div>
  );
}
