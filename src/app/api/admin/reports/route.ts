import { NextResponse } from "next/server";
import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { queryString, queryInt } from "@/lib/validation";
import { listContentReports, ContentReportStatus, isReportStatus } from "@/lib/moderation/reports";

const reportPageOptions = { fallback: 1, min: 1 } as const;
const reportPageSizeOptions = { fallback: 25, min: 1, max: 100 } as const;

function reportStatusFromQuery(params: URLSearchParams): ContentReportStatus {
  const rawStatus = queryString(params, "status", ContentReportStatus.OPEN);
  return isReportStatus(rawStatus) ? rawStatus : ContentReportStatus.OPEN;
}

function reportListQuery(params: URLSearchParams) {
  return {
    status: reportStatusFromQuery(params),
    page: queryInt(params, "page", reportPageOptions),
    pageSize: queryInt(params, "pageSize", reportPageSizeOptions),
  };
}

/**
 * GET /api/admin/reports — lists content reports for the admin moderation queue.
 * Gated on `content.moderate`. Supports ?status=open|reviewing|resolved|dismissed
 * and ?page= pagination.
 */
export const GET = createCapabilityHandler(
  CAPABILITIES.contentModerate,
  {},
  async ({ req }) => {
    const url = new URL(req.url);
    const result = await listContentReports(reportListQuery(url.searchParams));
    return NextResponse.json(result);
  },
);
