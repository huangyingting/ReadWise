"use client";

import { useMutation } from "@/hooks/useMutation";
import { postJson } from "@/lib/client-fetch";
import { Button } from "@/components/ui/Button";

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
    <div className="flex flex-col items-end gap-1">
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={complete}>
        {busy ? "Saving…" : "Mark complete"}
      </Button>
      {error ? (
        <span className="text-[length:var(--text-xs)] text-danger-text">{error}</span>
      ) : null}
    </div>
  );
}
