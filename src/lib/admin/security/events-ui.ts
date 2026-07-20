/**
 * PURE, client-safe helpers for the admin security-events panel (issue #1143).
 *
 * Owns the presentation contract for the in-process security-event ring buffer
 * (`GET /api/admin/security/events`) WITHOUT any React/DOM/network: the client
 * row DTO, the filter → query-string builder, the endpoint builder, and the
 * severity → Badge tone map. Every field is a sanitized id / enum / status /
 * route / IP / count / timestamp — never article text or user-private content.
 *
 * The row + severity types are single-sourced from the security-events module
 * via `import type` (erased at runtime, so the Prisma/server runtime is never
 * pulled into the browser bundle), narrowed with `Pick` to the metadata-only
 * columns the panel renders (deliberately EXCLUDES `meta` and the `alert` flag).
 */
import type { SecurityEventRecord, SecuritySeverity } from "@/lib/security/events";

/** The shared `Badge` tone union — kept local so this module stays free of the
 * component graph (it is imported by pure Node tests). Mirrors `BadgeProps["variant"]`. */
export type BadgeVariant = "neutral" | "primary" | "success" | "warning" | "danger";

/** A single sanitized security-event row (the 8 columns the panel renders). */
export type SecurityEventRow = Pick<
  SecurityEventRecord,
  "timestamp" | "type" | "severity" | "status" | "route" | "actorId" | "ip" | "count"
>;

/** The `{ events, count }` response body of the security-events route. */
export interface SecurityEventsResponse {
  events: SecurityEventRow[];
  count: number;
}

/** The severities the route accepts, in ascending order (for the filter Select). */
export const SECURITY_SEVERITIES: readonly SecuritySeverity[] = [
  "low",
  "medium",
  "high",
  "critical",
];

/** Default / max `limit` matching the route contract (1..500, default 100). */
export const DEFAULT_SECURITY_EVENTS_LIMIT = 100;
export const MAX_SECURITY_EVENTS_LIMIT = 500;

/** The point-in-time filter state the panel holds (`severity` "" = all). */
export interface SecurityEventsFilters {
  type: string;
  severity: string;
  limit: number;
}

/**
 * Builds the security-events query string, omitting empty `type` / `severity`
 * (the `limit` is always sent). PURE — assertable by a unit test.
 */
export function buildSecurityEventsQuery(filters: SecurityEventsFilters): string {
  const params = new URLSearchParams();
  const type = filters.type.trim();
  if (type) params.set("type", type);
  if (filters.severity) params.set("severity", filters.severity);
  params.set("limit", String(filters.limit));
  return params.toString();
}

/** The security-events endpoint for a given filter state. */
export function securityEventsEndpoint(filters: SecurityEventsFilters): string {
  return `/api/admin/security/events?${buildSecurityEventsQuery(filters)}`;
}

const SEVERITY_BADGE: Record<SecuritySeverity, BadgeVariant> = {
  low: "neutral",
  medium: "primary",
  high: "warning",
  critical: "danger",
};

/** Badge tone for a security-event severity. PURE. */
export function severityBadgeVariant(severity: SecuritySeverity | string): BadgeVariant {
  return SEVERITY_BADGE[severity as SecuritySeverity] ?? "neutral";
}
