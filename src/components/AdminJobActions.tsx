"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/client-fetch";
import ConfirmAction from "@/components/ConfirmAction";
import { Button } from "@/components/ui/Button";

/**
 * Inline admin actions for a single job row. Retry is a direct (safe) action;
 * cancel and archive use the shared inline-confirm pattern. Each action POSTs to
 * `/api/admin/jobs/[id]` with `{ action }` then refreshes the dashboard.
 */
export default function AdminJobActions({
  jobId,
  canRetry,
  canCancel,
  canArchive,
}: {
  jobId: string;
  canRetry: boolean;
  canCancel: boolean;
  canArchive: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "retry" | "cancel" | "archive">(null);
  const [error, setError] = useState<string | null>(null);
  const [openPanel, setOpenPanel] = useState<"cancel" | "archive" | null>(null);

  async function run(action: "retry" | "cancel" | "archive") {
    setBusy(action);
    setError(null);
    try {
      await postJson(`/api/admin/jobs/${jobId}`, { action });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="admin-actions">
      <div className="admin-actions-row">
        {canRetry && (
          <Button
            variant="secondary"
            size="sm"
            loading={busy === "retry"}
            disabled={busy !== null}
            onClick={() => run("retry")}
          >
            Retry
          </Button>
        )}
        {canCancel && (
          <ConfirmAction
            triggerLabel="Cancel"
            triggerVariant="danger-ghost"
            confirmVariant="danger"
            confirmLabel="Confirm cancel"
            confirmMessage="Cancel this job? It will be moved to the dead-letter queue and stop being retried."
            onConfirm={() => run("cancel")}
            loading={busy === "cancel"}
            disabled={busy !== null}
            open={openPanel === "cancel"}
            onOpenChange={(v) => setOpenPanel(v ? "cancel" : null)}
          />
        )}
        {canArchive && (
          <ConfirmAction
            triggerLabel="Archive"
            triggerVariant="danger-ghost"
            confirmVariant="danger"
            confirmLabel="Confirm archive"
            confirmMessage="Permanently delete this finished job record? This cannot be undone."
            onConfirm={() => run("archive")}
            loading={busy === "archive"}
            disabled={busy !== null}
            open={openPanel === "archive"}
            onOpenChange={(v) => setOpenPanel(v ? "archive" : null)}
          />
        )}
      </div>
      {error && (
        <p
          className="text-danger-text text-[length:var(--text-sm)]"
          style={{ margin: 0 }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
