"use client";

import { deleteJson } from "@/lib/client-fetch";
import { useMutation } from "@/hooks/useMutation";
import ConfirmAction from "@/components/ConfirmAction";

interface DeleteAssignmentButtonProps {
  assignmentId: string;
  assignmentTitle: string;
}

export default function DeleteAssignmentButton({
  assignmentId,
  assignmentTitle,
}: DeleteAssignmentButtonProps) {
  const { busy, error, run } = useMutation("Failed to delete assignment");

  async function deleteAssignment() {
    await run(async () => {
      await deleteJson<{ ok: true }>(
        `/api/assignments/${encodeURIComponent(assignmentId)}`,
      );
    }, { refreshOnSuccess: true });
  }

  return (
    <div className="flex flex-col items-end gap-[var(--space-1)]">
      <ConfirmAction
        triggerLabel="Delete"
        triggerAriaLabel={`Delete assignment ${assignmentTitle}`}
        triggerVariant="danger-ghost"
        confirmVariant="danger"
        confirmLabel="Confirm delete"
        confirmMessage={`Delete "${assignmentTitle}" and its completion history from this classroom?`}
        onConfirm={deleteAssignment}
        loading={busy}
        disabled={busy}
        className="!min-w-0"
      />
      {error ? (
        <p role="alert" className="m-0 text-[length:var(--text-xs)] text-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
