"use client";

import { Button } from "@/components/ui/Button";
import { useMutation } from "@/hooks/useMutation";
import {
  submitReportStatus,
  type TerminalReportStatus,
} from "@/lib/moderation/report-actions";

const RESOLVE: TerminalReportStatus = "RESOLVED";
const DISMISS: TerminalReportStatus = "DISMISSED";

/**
 * Client action island for ONE actionable content report (OPEN / REVIEWING).
 *
 * Replaces the dead `_method`-hidden POST forms (Next.js App Router never
 * translates `_method`, so the old Resolve/Dismiss submits hit the PATCH-only
 * route as a raw POST → 405). This issues a real `PATCH /api/admin/reports/{id}`
 * with `{ status }` (CSRF + credentials via `patchJson`), disables the controls
 * while busy, surfaces an inline error, and refreshes the server component so
 * the row moves to its terminal state.
 */
export default function AdminReportActions({ reportId }: { reportId: string }) {
  const { busy, error, run } = useMutation("Could not update the report");

  function update(status: TerminalReportStatus) {
    return run(() => submitReportStatus(reportId, status), { refreshOnSuccess: true });
  }

  return (
    <div className="admin-actions">
      <div className="admin-actions-row">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => update(RESOLVE)}
          disabled={busy}
        >
          Resolve
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => update(DISMISS)}
          disabled={busy}
        >
          Dismiss
        </Button>
      </div>

      {error && (
        <p className="m-0 text-danger-text text-[length:var(--text-sm)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
