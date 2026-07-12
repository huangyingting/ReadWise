"use client";

import { useState } from "react";
import { deleteJson } from "@/lib/client-fetch";
import { useMutation } from "@/hooks/useMutation";
import ConfirmAction from "@/components/ConfirmAction";

interface RemoveStudentButtonProps {
  classroomId: string;
  studentId: string;
  studentLabel: string;
}

export default function RemoveStudentButton({
  classroomId,
  studentId,
  studentLabel,
}: RemoveStudentButtonProps) {
  const [removed, setRemoved] = useState(false);
  const { busy, error, run } = useMutation("Failed to remove student");

  async function removeStudent() {
    await run(async () => {
      await deleteJson<{ ok: true }>(
        `/api/classrooms/${encodeURIComponent(classroomId)}/members/${encodeURIComponent(studentId)}`,
      );
      setRemoved(true);
    }, { refreshOnSuccess: true });
  }

  if (removed) return null;

  return (
    <div className="flex flex-col items-end gap-[var(--space-1)]">
      <ConfirmAction
        triggerLabel="Remove"
        triggerAriaLabel={`Remove ${studentLabel}`}
        triggerVariant="danger-ghost"
        confirmVariant="danger"
        confirmLabel="Confirm remove"
        confirmMessage={`Remove ${studentLabel} from this classroom?`}
        onConfirm={removeStudent}
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
