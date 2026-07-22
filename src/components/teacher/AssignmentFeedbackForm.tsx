"use client";

import { useState, type FormEvent } from "react";
import { patchJson } from "@/lib/client-fetch";
import { Textarea } from "@/components/ui/Textarea";
import { Field } from "@/components/ui/Field";
import { useMutation } from "@/hooks/useMutation";
import { TeacherFormShell } from "./TeacherFormShell";

interface AssignmentFeedbackFormProps {
  assignmentId: string;
  studentId: string;
  initialFeedback: string | null;
  studentLabel?: string;
}

const FEEDBACK_MAX_LENGTH = 2000;

/**
 * Lets a teacher write or update feedback on a student's assignment completion.
 * PATCHes `/api/assignments/[id]/completions/[studentId]` with `{ feedback }`.
 * An empty string clears existing feedback.
 */
export default function AssignmentFeedbackForm({
  assignmentId,
  studentId,
  initialFeedback,
  studentLabel,
}: AssignmentFeedbackFormProps) {
  const [feedback, setFeedback] = useState(initialFeedback ?? "");
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useMutation("Failed to save feedback");

  const fieldLabel = studentLabel
    ? `Feedback for ${studentLabel}`
    : "Teacher feedback";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    await run(
      async () => {
        await patchJson(
          `/api/assignments/${encodeURIComponent(assignmentId)}/completions/${encodeURIComponent(studentId)}`,
          { feedback: feedback.trim() },
        );
        setSaved(true);
      },
      { refreshOnSuccess: true },
    );
  }

  return (
    <TeacherFormShell
      onSubmit={submit}
      busy={busy}
      canSubmit
      submitLabel={saved && !error ? "Saved" : "Save feedback"}
      busyLabel="Saving…"
    >
      <Field label={fieldLabel} error={error ?? undefined}>
        <Textarea
          value={feedback}
          onChange={(e) => {
            setFeedback(e.target.value);
            setSaved(false);
          }}
          placeholder="Leave feedback for this student…"
          rows={2}
          maxLength={FEEDBACK_MAX_LENGTH}
          disabled={busy}
        />
      </Field>
    </TeacherFormShell>
  );
}
