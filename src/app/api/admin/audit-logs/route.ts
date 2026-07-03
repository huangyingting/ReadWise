import { NextResponse } from "next/server";
import { createAdminHandler } from "@/lib/api-handler";
import { AUDIT_ACTIONS, listAuditLogs, recordAuditFromRequest } from "@/lib/security/audit";
import { queryInt, queryString } from "@/lib/validation";

const QUERY_VALUE_MAX_LENGTH = 120;

type AuditLogQuery = {
  page: number;
  pageSize: number;
  action: string | null;
  actorId: string | null;
  targetType: string | null;
};

function readFilter(params: URLSearchParams, name: string) {
  const value = queryString(params, name).trim();
  return value ? value.slice(0, QUERY_VALUE_MAX_LENGTH) : null;
}

function auditLogQuery(params: URLSearchParams) {
  return {
    ok: true as const,
    value: {
      page: queryInt(params, "page", { fallback: 1, min: 1 }),
      pageSize: queryInt(params, "pageSize", { fallback: 50, min: 1, max: 100 }),
      action: readFilter(params, "action"),
      actorId: readFilter(params, "actorId"),
      targetType: readFilter(params, "targetType"),
    },
  };
}

function auditReadMetadata(query: AuditLogQuery) {
  return {
    page: query.page,
    pageSize: query.pageSize,
    action: query.action,
    actorId: query.actorId,
    targetType: query.targetType,
  };
}

export const GET = createAdminHandler(
  { query: auditLogQuery },
  async ({ req, query, session, requestId }) => {
    await recordAuditFromRequest({
      req,
      session,
      requestId,
      action: AUDIT_ACTIONS.adminAuditLogRead,
      targetType: "audit_log",
      targetId: null,
      metadata: auditReadMetadata(query),
    });
    const result = await listAuditLogs(query);
    return NextResponse.json(result);
  },
);
