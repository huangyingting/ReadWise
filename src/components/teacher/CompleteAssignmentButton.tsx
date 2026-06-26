"use client";

import { useMutation } from "@/hooks/useMutation";
import { postJson } from "@/lib/client-fetch";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";

/**
 * Lets a student mark an assignment complete (RW-061). Posts the student's OWN
 * completion to `/api/assignments/[id]/completion` (the server takes the student
 * id from the session, never the body).
 */
export default function CompleteAssignmentButton({
  assignmentId,
  completed,
}: {
  assignmentId: string;
  completed: boolean;
}) {
  const { busy, error, run } = useMutation("Failed to update");

  async function complete() {
    await run(async () => {
      await postJson(`/api/assignments/${assignmentId}/completion`, {
        status: "COMPLETED",
      });
    }, { refreshOnSuccess: true });
  }

  if (completed) {
    return (
      <span className="text-[length:var(--text-sm)] text-success-text">Completed</span>
    );
  }

  return (
    <Field error={error ?? undefined}>
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={complete}>
        {busy ? "Saving…" : "Mark complete"}
      </Button>
    </Field>
  );
}
