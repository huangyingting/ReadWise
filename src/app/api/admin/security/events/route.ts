import { NextResponse } from "next/server";
import { createAdminHandler } from "@/lib/api-handler";
import { queryInt, queryString } from "@/lib/validation";
import {
  getRecentSecurityEvents,
  type SecuritySeverity,
} from "@/lib/security-events";

const SEVERITIES: readonly SecuritySeverity[] = ["low", "medium", "high", "critical"];

type SecurityEventsQuery = {
  limit: number;
  type: string | null;
  severity: SecuritySeverity | null;
};

function parseQuery(params: URLSearchParams) {
  const rawSeverity = queryString(params, "severity").trim().toLowerCase();
  const severity = (SEVERITIES as readonly string[]).includes(rawSeverity)
    ? (rawSeverity as SecuritySeverity)
    : null;
  const rawType = queryString(params, "type").trim();
  return {
    ok: true as const,
    value: {
      limit: queryInt(params, "limit", { fallback: 100, min: 1, max: 500 }),
      type: rawType ? rawType.slice(0, 120) : null,
      severity,
    } satisfies SecurityEventsQuery,
  };
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
export const GET = createAdminHandler(
  { query: parseQuery },
  async ({ query }) => {
    let events = getRecentSecurityEvents(query.limit);
    if (query.type) events = events.filter((event) => event.type === query.type);
    if (query.severity) events = events.filter((event) => event.severity === query.severity);
    return NextResponse.json(
      { events, count: events.length },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  },
);
