"use client";

import { patchJson } from "@/lib/client-fetch";
import { useMutation } from "@/hooks/useMutation";
import { Button } from "@/components/ui/Button";

interface PublishAssignmentButtonProps {
  assignmentId: string;
  assignmentTitle: string;
}

export default function PublishAssignmentButton({
  assignmentId,
  assignmentTitle,
}: PublishAssignmentButtonProps) {
  const { busy, error, run } = useMutation("Failed to publish assignment");

  async function publishAssignment() {
    await run(async () => {
      await patchJson(`/api/assignments/${encodeURIComponent(assignmentId)}`, {
        publishState: "PUBLISHED",
      });
    }, { refreshOnSuccess: true });
  }

  return (
    <div className="flex flex-col items-end gap-[var(--space-1)]">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`Publish assignment ${assignmentTitle}`}
        disabled={busy}
        onClick={publishAssignment}
        className="!min-w-0"
      >
        {busy ? "Publishing…" : "Publish"}
      </Button>
      {error ? (
        <p role="alert" className="m-0 text-[length:var(--text-xs)] text-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
