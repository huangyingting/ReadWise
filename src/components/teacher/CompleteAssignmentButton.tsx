"use client";

import { useMutation } from "@/hooks/useMutation";
import { postJson } from "@/lib/client-fetch";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";

const COMPLETED_STATUS = "COMPLETED";
const IN_PROGRESS_STATUS = "IN_PROGRESS";

function completionEndpoint(assignmentId: string) {
  return `/api/assignments/${assignmentId}/completion`;
}

/**
 * Lets a student mark an assignment complete (RW-061). Posts the student's OWN
 * completion to `/api/assignments/[id]/completion` (the server takes the student
 * id from the session, never the body).
 *
 * A MANUAL completion (no quiz score) can be reverted back to in-progress —
 * quiz-driven completions are read-only here so they can only change by taking
 * the quiz again.
 */
export default function CompleteAssignmentButton({
  assignmentId,
  completed,
  quizScore = null,
}: {
  assignmentId: string;
  completed: boolean;
  quizScore?: number | null;
}) {
  const { busy, error, run } = useMutation("Failed to update");

  async function setStatus(status: string) {
    await run(async () => {
      await postJson(completionEndpoint(assignmentId), { status });
    }, { refreshOnSuccess: true });
  }

  if (completed) {
    if (quizScore != null) {
      return (
        <span className="text-[length:var(--text-sm)] text-success-text">Completed</span>
      );
    }
    return (
      <Field error={error ?? undefined}>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => setStatus(IN_PROGRESS_STATUS)}
        >
          {busy ? "Saving…" : "Undo"}
        </Button>
      </Field>
    );
  }

  return (
    <Field error={error ?? undefined}>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={() => setStatus(COMPLETED_STATUS)}
      >
        {busy ? "Saving…" : "Mark complete"}
      </Button>
    </Field>
  );
}
