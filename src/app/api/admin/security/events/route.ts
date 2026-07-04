import { NextResponse } from "next/server";
import { createCapabilityHandler } from "@/lib/api-handler";
import { CAPABILITIES } from "@/lib/rbac";
import { queryInt, queryString } from "@/lib/validation";
import {
  getRecentSecurityEvents,
  type SecuritySeverity,
} from "@/lib/security/events";

const SEVERITIES: readonly SecuritySeverity[] = ["low", "medium", "high", "critical"];
const QUERY_VALUE_MAX_LENGTH = 120;

type SecurityEventsQuery = {
  limit: number;
  type: string | null;
  severity: SecuritySeverity | null;
};

function parseQuery(params: URLSearchParams) {
  const rawType = queryString(params, "type").trim();
  return {
    ok: true as const,
    value: {
      limit: queryInt(params, "limit", { fallback: 100, min: 1, max: 500 }),
      type: rawType ? rawType.slice(0, QUERY_VALUE_MAX_LENGTH) : null,
      severity: parseSeverity(params),
    } satisfies SecurityEventsQuery,
  };
}

function parseSeverity(params: URLSearchParams): SecuritySeverity | null {
  const severity = queryString(params, "severity").trim().toLowerCase();
  return (SEVERITIES as readonly string[]).includes(severity)
    ? (severity as SecuritySeverity)
    : null;
}

function filterSecurityEvents(
  events: ReturnType<typeof getRecentSecurityEvents>,
  query: SecurityEventsQuery,
) {
  let filtered = events;
  if (query.type) filtered = filtered.filter((event) => event.type === query.type);
  if (query.severity) filtered = filtered.filter((event) => event.severity === query.severity);
  return filtered;
}

/**
 * GET /api/admin/security/events (RW-029)
 *
 * Admin-only. Returns the most recent security events from the in-memory ring
 * buffer (newest first) so a security operator can investigate suspicious
 * activity — repeated 401/403s, rate-limit 429s, blocked cross-site requests,
 * admin mutations, and failed imports. Provider-agnostic (no DB table); for
 * durable history forward the structured `security.event` logs / metrics to a
 * SIEM. No-store: the snapshot is point-in-time.
 */
export const GET = createCapabilityHandler(
  CAPABILITIES.securityView,
  { query: parseQuery },
  async ({ query }) => {
    const events = filterSecurityEvents(getRecentSecurityEvents(query.limit), query);
    return NextResponse.json(
      { events, count: events.length },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  },
);
