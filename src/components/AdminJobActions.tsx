"use client";

import { postJson } from "@/lib/client-fetch";
import ConfirmAction from "@/components/ConfirmAction";
import { Button } from "@/components/ui/Button";
import { useAdminAction } from "@/hooks/useAdminAction";

type JobAction = "retry" | "cancel" | "archive";

interface AdminJobActionsProps {
  jobId: string;
  canRetry: boolean;
  canCancel: boolean;
  canArchive: boolean;
}

function postJobAction(jobId: string, action: JobAction): Promise<void> {
  return postJson<void>(`/api/admin/jobs/${jobId}`, { action });
}

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
}: AdminJobActionsProps) {
  const { busy, error, openPanel, setOpenPanel, run } =
    useAdminAction<JobAction>();

  const busyAction = busy !== null;
  const runJobAction = (action: JobAction) =>
    run(action, () => postJobAction(jobId, action));

  return (
    <div className="admin-actions">
      <div className="admin-actions-row">
        {canRetry && (
          <Button
            variant="secondary"
            size="sm"
            loading={busy === "retry"}
            disabled={busyAction}
            onClick={() => runJobAction("retry")}
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
            onConfirm={() => runJobAction("cancel")}
            loading={busy === "cancel"}
            disabled={busyAction}
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
            onConfirm={() => runJobAction("archive")}
            loading={busy === "archive"}
            disabled={busyAction}
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
