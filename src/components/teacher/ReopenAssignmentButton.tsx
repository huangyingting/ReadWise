"use client";

import { useState } from "react";
import { postJson } from "@/lib/client-fetch";
import { useMutation } from "@/hooks/useMutation";
import ConfirmAction from "@/components/ConfirmAction";

interface ReopenAssignmentButtonProps {
  assignmentId: string;
  assignmentTitle: string;
}

export default function ReopenAssignmentButton({
  assignmentId,
  assignmentTitle,
}: ReopenAssignmentButtonProps) {
  const { busy, error, run } = useMutation("Failed to re-open assignment");
  const [summary, setSummary] = useState<string | null>(null);

  async function reopen() {
    await run(async () => {
      const { result } = await postJson<{ result: { reopened: number } }>(
        `/api/assignments/${encodeURIComponent(assignmentId)}/reopen`,
        {},
      );
      setSummary(
        `Re-opened for ${result.reopened} student${result.reopened === 1 ? "" : "s"}.`,
      );
    }, { refreshOnSuccess: true });
  }

  return (
    <div className="flex flex-col items-end gap-[var(--space-1)]">
      <ConfirmAction
        triggerLabel="Re-open"
        triggerAriaLabel={`Re-open assignment ${assignmentTitle}`}
        triggerVariant="outline"
        confirmVariant="primary"
        confirmLabel="Re-open assignment"
        confirmMessage="Re-open this assignment? Completed students will need to complete it again."
        onConfirm={reopen}
        loading={busy}
        disabled={busy}
        className="!min-w-0"
      />
      {summary ? (
        <p aria-live="polite" className="m-0 text-[length:var(--text-xs)] text-text-muted">
          {summary}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 text-[length:var(--text-xs)] text-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
