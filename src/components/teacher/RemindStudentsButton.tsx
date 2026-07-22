"use client";

import { useState } from "react";
import { postJson } from "@/lib/client-fetch";
import { useMutation } from "@/hooks/useMutation";
import ConfirmAction from "@/components/ConfirmAction";

interface RemindStudentsButtonProps {
  assignmentId: string;
  assignmentTitle: string;
  pendingCount: number; // students not yet completed (inProgress + notStarted)
}

export default function RemindStudentsButton({
  assignmentId,
  assignmentTitle,
  pendingCount,
}: RemindStudentsButtonProps) {
  const { busy, error, run } = useMutation("Failed to send reminders");
  const [summary, setSummary] = useState<string | null>(null);

  async function remind() {
    await run(async () => {
      const { result } = await postJson<{
        result: {
          total: number;
          notified: number;
          skipped: number;
          suppressed: number;
        };
      }>(`/api/assignments/${encodeURIComponent(assignmentId)}/remind`, {});
      setSummary(
        `Reminded ${result.notified} of ${result.total} student${result.total === 1 ? "" : "s"}.`,
      );
    });
  }

  return (
    <div className="flex flex-col items-end gap-[var(--space-1)]">
      <ConfirmAction
        triggerLabel="Remind"
        triggerAriaLabel={`Remind students about ${assignmentTitle}`}
        triggerVariant="outline"
        confirmVariant="primary"
        confirmLabel="Send reminders"
        confirmMessage={`Send a push reminder to the ${pendingCount} student${pendingCount === 1 ? "" : "s"} who haven't completed "${assignmentTitle}"? Students without notifications enabled are skipped.`}
        onConfirm={remind}
        loading={busy}
        disabled={busy || pendingCount === 0}
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
