import { NextResponse } from "next/server";
import { createAdminHandler } from "@/lib/api-handler";
import { listAuditLogs } from "@/lib/audit";
import { queryInt, queryString } from "@/lib/validation";

type AuditLogQuery = {
  page: number;
  pageSize: number;
  action: string | null;
  actorId: string | null;
  targetType: string | null;
};

function auditLogQuery(params: URLSearchParams) {
  const readFilter = (name: string) => {
    const value = queryString(params, name).trim();
    return value ? value.slice(0, 120) : null;
  };
  return {
    ok: true as const,
    value: {
      page: queryInt(params, "page", { fallback: 1, min: 1 }),
      pageSize: queryInt(params, "pageSize", { fallback: 50, min: 1, max: 100 }),
      action: readFilter("action"),
      actorId: readFilter("actorId"),
      targetType: readFilter("targetType"),
    },
  };
}

export const GET = createAdminHandler(
  { query: auditLogQuery },
  async ({ query }) => {
    const result = await listAuditLogs(query);
    return NextResponse.json(result);
  },
);
