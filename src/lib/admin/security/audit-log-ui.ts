/**
 * PURE, client-safe helpers for the admin audit-log panel (issue #1143).
 *
 * Owns the presentation contract for the durable, DB-backed audit trail
 * (`GET /api/admin/audit-logs`) WITHOUT any React/DOM/network: the client row
 * DTO, the filter → query-string builder, the endpoint builder, and the page
 * bounds. Every rendered field is a sanitized id / enum / role / target id /
 * IP / request id / timestamp.
 *
 * The row type is single-sourced from the audit module via `import type`
 * (erased at runtime — no Prisma runtime in the browser bundle) and narrowed
 * with `Pick` to the METADATA-ONLY columns the panel renders: it deliberately
 * EXCLUDES the `metadata` blob and the free-text `userAgent` so no code path
 * can render user-private content, even though the wire response carries them.
 */
import type { AuditLogRow as AuditLogRecord } from "@/lib/security/audit";

/**
 * A single audit-log row as rendered by the panel (dates arrive as ISO strings
 * over the JSON API). Single-sourced, metadata-only — no `metadata`/`userAgent`.
 */
export type AuditLogRow = Pick<
  AuditLogRecord,
  | "id"
  | "action"
  | "actorId"
  | "actorRole"
  | "targetType"
  | "targetId"
  | "requestId"
  | "ipAddress"
> & { createdAt: string };

/** The paginated response body of the audit-logs route. */
export interface AuditLogPage {
  logs: AuditLogRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Default / max page size matching the route contract (1..100, default 50). */
export const DEFAULT_AUDIT_PAGE_SIZE = 50;
export const MAX_AUDIT_PAGE_SIZE = 100;

/** The filter + pagination state the panel holds. */
export interface AuditLogFilters {
  page: number;
  pageSize: number;
  action: string;
  actorId: string;
  targetType: string;
}

/**
 * Builds the audit-logs query string. `page` + `pageSize` are always sent;
 * empty `action` / `actorId` / `targetType` are omitted. PURE.
 */
export function buildAuditLogQuery(filters: AuditLogFilters): string {
  const params = new URLSearchParams();
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  const action = filters.action.trim();
  const actorId = filters.actorId.trim();
  const targetType = filters.targetType.trim();
  if (action) params.set("action", action);
  if (actorId) params.set("actorId", actorId);
  if (targetType) params.set("targetType", targetType);
  return params.toString();
}

/** The audit-logs endpoint for a given filter state. */
export function auditLogEndpoint(filters: AuditLogFilters): string {
  return `/api/admin/audit-logs?${buildAuditLogQuery(filters)}`;
}
