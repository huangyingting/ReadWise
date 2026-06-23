"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function complete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/assignments/${assignmentId}/completion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "COMPLETED" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setBusy(false);
    }
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
