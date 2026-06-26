import { NextResponse } from "next/server";
import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { queryString, queryInt } from "@/lib/validation";
import { listContentReports, ContentReportStatus, isReportStatus } from "@/lib/moderation/reports";

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
    const params = url.searchParams;

    const rawStatus = queryString(params, "status", ContentReportStatus.OPEN);
    const status = isReportStatus(rawStatus) ? (rawStatus as ContentReportStatus) : ContentReportStatus.OPEN;
    const page = queryInt(params, "page", { fallback: 1, min: 1 });
    const pageSize = queryInt(params, "pageSize", { fallback: 25, min: 1, max: 100 });

    const result = await listContentReports({ status, page, pageSize });
    return NextResponse.json(result);
  },
);
