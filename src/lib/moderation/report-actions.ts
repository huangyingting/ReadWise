import type { ContentReportStatus } from "@prisma/client";

import { patchJson } from "@/lib/client-fetch";

/**
 * The two TERMINAL statuses a moderator can set from the Reports queue — exactly
 * the set the `PATCH /api/admin/reports/[id]` route validates
 * (`oneOf([RESOLVED, DISMISSED])`). Kept as a string-literal union (via a
 * type-only import) so this client-callable helper never pulls the Prisma
 * runtime into the browser bundle.
 */
export type TerminalReportStatus = Extract<ContentReportStatus, "RESOLVED" | "DISMISSED">;

/** Response shape returned by the report-status PATCH route. */
export interface UpdateReportStatusResponse {
  ok: boolean;
  reportId: string;
  status: ContentReportStatus;
}

/** The admin report-status endpoint for a given report id. */
export function reportStatusEndpoint(reportId: string): string {
  return `/api/admin/reports/${reportId}`;
}

/**
 * Resolve or dismiss a content report via the audited PATCH route. `patchJson`
 * attaches CSRF + credentials; the calling island owns busy/error state and
 * refreshes the server component on success. Sends only the terminal `status`
 * enum — never any report note, article text, or other user-private content.
 */
export function submitReportStatus(
  reportId: string,
  status: TerminalReportStatus,
): Promise<UpdateReportStatusResponse> {
  return patchJson<UpdateReportStatusResponse>(reportStatusEndpoint(reportId), { status });
}
