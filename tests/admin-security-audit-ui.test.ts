/**
 * Unit tests for the /admin/security audit-log + event-filter UI wiring (#1143).
 *
 * The page previously rendered only posture StatCards + a STATIC, unfiltered
 * list of the 100 most-recent in-process security events; two backing routes
 * (`GET /api/admin/security/events` with type/severity filters, and the durable
 * `GET /api/admin/audit-logs`) were unsurfaced. This adds two client islands —
 * `AdminSecurityEventsPanel` and `AdminAuditLogPanel` — modelled on
 * DeletedArticleQueue.
 *
 * Mirrors the source-string + mocked-`client-fetch` conventions of
 * tests/admin-deleted-articles-ui.test.ts and tests/admin-reports-ui.test.ts
 * (no jsdom / real DOM). The pure query-string builders that feed `getJson` are
 * asserted directly (and via a `getJson` mock); the islands are verified by
 * source-string. Backend behaviour stays covered by the route tests.
 */
process.env.LOG_LEVEL = "error";

import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

import {
  DEFAULT_SECURITY_EVENTS_LIMIT,
  MAX_SECURITY_EVENTS_LIMIT,
  SECURITY_SEVERITIES,
  buildSecurityEventsQuery,
  securityEventsEndpoint,
  severityBadgeVariant,
} from "@/lib/admin/security/events-ui";
import {
  DEFAULT_AUDIT_PAGE_SIZE,
  MAX_AUDIT_PAGE_SIZE,
  auditLogEndpoint,
  buildAuditLogQuery,
} from "@/lib/admin/security/audit-log-ui";

const WORKTREE = resolve(import.meta.dirname, "..");

function readSrc(relPath: string): string {
  return readFileSync(join(WORKTREE, relPath), "utf8");
}

type GetCall = { url: string };
let getCalls: GetCall[] = [];
let getResponse: unknown;
let clientFetch: typeof import("@/lib/client-fetch");

before(async () => {
  mock.module("@/lib/client-fetch", {
    namedExports: {
      getJson: async (url: string) => {
        getCalls.push({ url });
        return getResponse;
      },
    },
  });
  clientFetch = await import("@/lib/client-fetch");
});

beforeEach(() => {
  getCalls = [];
  getResponse = null;
});

// ---------------------------------------------------------------------------
// Pure query-string builders (the URLs the islands feed to getJson)
// ---------------------------------------------------------------------------

test("buildSecurityEventsQuery includes type+severity when set, always sends limit", () => {
  const q = buildSecurityEventsQuery({ type: "csrf_blocked", severity: "high", limit: 100 });
  const params = new URLSearchParams(q);
  assert.equal(params.get("type"), "csrf_blocked");
  assert.equal(params.get("severity"), "high");
  assert.equal(params.get("limit"), "100");
});

test("buildSecurityEventsQuery omits empty type + 'all' severity", () => {
  const q = buildSecurityEventsQuery({ type: "   ", severity: "", limit: DEFAULT_SECURITY_EVENTS_LIMIT });
  const params = new URLSearchParams(q);
  assert.equal(params.has("type"), false, "blank type omitted");
  assert.equal(params.has("severity"), false, "empty severity ('all') omitted");
  assert.equal(params.get("limit"), String(DEFAULT_SECURITY_EVENTS_LIMIT));
});

test("securityEventsEndpoint targets the events route", () => {
  const url = securityEventsEndpoint({ type: "rate_limited", severity: "", limit: 100 });
  assert.ok(url.startsWith("/api/admin/security/events?"), "hits the events route");
  assert.ok(url.includes("type=rate_limited"));
  assert.ok(!url.includes("severity="), "no severity param when 'all'");
});

test("severity bounds + Select options match the route contract", () => {
  assert.deepEqual([...SECURITY_SEVERITIES], ["low", "medium", "high", "critical"]);
  assert.equal(MAX_SECURITY_EVENTS_LIMIT, 500);
  assert.equal(severityBadgeVariant("critical"), "danger");
  assert.equal(severityBadgeVariant("low"), "neutral");
  assert.equal(severityBadgeVariant("weird"), "neutral", "unknown severity falls back to neutral");
});

test("buildAuditLogQuery always sends page+pageSize, omits empty filters", () => {
  const q = buildAuditLogQuery({ page: 2, pageSize: 50, action: "", actorId: "  ", targetType: "" });
  const params = new URLSearchParams(q);
  assert.equal(params.get("page"), "2");
  assert.equal(params.get("pageSize"), "50");
  assert.equal(params.has("action"), false);
  assert.equal(params.has("actorId"), false);
  assert.equal(params.has("targetType"), false);
});

test("buildAuditLogQuery includes action+actorId+targetType when set", () => {
  const q = buildAuditLogQuery({
    page: 1,
    pageSize: DEFAULT_AUDIT_PAGE_SIZE,
    action: "admin.force_rescrape.activate",
    actorId: "user-1",
    targetType: "article",
  });
  const params = new URLSearchParams(q);
  assert.equal(params.get("action"), "admin.force_rescrape.activate");
  assert.equal(params.get("actorId"), "user-1");
  assert.equal(params.get("targetType"), "article");
  assert.equal(MAX_AUDIT_PAGE_SIZE, 100);
});

test("auditLogEndpoint targets the audit-logs route with paging", () => {
  const url = auditLogEndpoint({ page: 3, pageSize: 50, action: "", actorId: "", targetType: "" });
  assert.ok(url.startsWith("/api/admin/audit-logs?"), "hits the audit-logs route");
  assert.ok(url.includes("page=3"));
  assert.ok(url.includes("pageSize=50"));
});

// ---------------------------------------------------------------------------
// getJson mock — the exact call the islands make lands on the built URL
// ---------------------------------------------------------------------------

test("getJson receives the built events URL (type+severity+limit)", async () => {
  await clientFetch.getJson(securityEventsEndpoint({ type: "login_failed", severity: "critical", limit: 200 }));
  assert.equal(getCalls.length, 1);
  assert.equal(
    getCalls[0]?.url,
    "/api/admin/security/events?type=login_failed&severity=critical&limit=200",
  );
});

test("getJson receives the built audit URL (page+action, empties omitted)", async () => {
  await clientFetch.getJson(
    auditLogEndpoint({ page: 1, pageSize: 50, action: "admin.audit_log.read", actorId: "", targetType: "" }),
  );
  assert.equal(getCalls[0]?.url, "/api/admin/audit-logs?page=1&pageSize=50&action=admin.audit_log.read");
});

// ---------------------------------------------------------------------------
// AdminSecurityEventsPanel island — primitives, states, filters, token-driven
// ---------------------------------------------------------------------------

test("AdminSecurityEventsPanel is a client island fetching the events route with filters", () => {
  const src = readSrc("src/components/admin/security/AdminSecurityEventsPanel.tsx");
  assert.ok(src.includes('"use client"'), "must be a client component");
  assert.ok(src.includes("getJson"), "loads via getJson");
  assert.ok(src.includes("securityEventsEndpoint"), "builds the events URL from the pure helper");
  assert.ok(src.includes("classifyAdminFetchError"), "classifies fetch errors");
  assert.ok(src.includes("<Select"), "has a severity Select filter");
  assert.ok(src.includes("<Input"), "has a type Input filter");
  assert.ok(src.includes("Refresh"), "has a Refresh action (point-in-time snapshot)");
  assert.ok(src.includes("PanelSkeleton"), "renders a loading skeleton");
  assert.ok(src.includes("EmptyState"), "renders an empty state");
  assert.ok(src.includes("PanelErrorState"), "renders the error/forbidden/unauthorized states");
  assert.ok(src.includes('aria-live'), "has an aria-live count line");
  // Same 8 columns the page showed before.
  for (const header of ["Time", "Type", "Severity", "Status", "Route", "Actor", "IP", "Count"]) {
    assert.ok(src.includes(`>${header}<`), `keeps the ${header} column`);
  }
});

// ---------------------------------------------------------------------------
// AdminAuditLogPanel island — primitives, states, pagination, metadata-only
// ---------------------------------------------------------------------------

test("AdminAuditLogPanel is a client island fetching the audit route, paginated", () => {
  const src = readSrc("src/components/admin/security/AdminAuditLogPanel.tsx");
  assert.ok(src.includes('"use client"'), "must be a client component");
  assert.ok(src.includes("getJson"), "loads via getJson");
  assert.ok(src.includes("auditLogEndpoint"), "builds the audit URL from the pure helper");
  assert.ok(src.includes("classifyAdminFetchError"), "classifies fetch errors");
  assert.ok(src.includes("PanelPagination"), "paginates prev/next");
  assert.ok(src.includes("PanelSkeleton"), "renders a loading skeleton");
  assert.ok(src.includes("EmptyState"), "renders an empty state");
  assert.ok(src.includes("PanelErrorState"), "renders the error/forbidden/unauthorized states");
  // action / actorId / targetType filters.
  for (const field of ["Action", "Actor id", "Target type"]) {
    assert.ok(src.includes(field), `has the ${field} filter`);
  }
});

test("AdminAuditLogPanel renders ONLY metadata columns — never metadata blob / userAgent", () => {
  const src = readSrc("src/components/admin/security/AdminAuditLogPanel.tsx");
  assert.ok(!src.includes(".metadata"), "must not access the sanitized metadata blob");
  assert.ok(!src.includes(".userAgent"), "must not access the free-text userAgent");
  // The rendered columns are metadata-only.
  for (const header of ["Time", "Action", "Actor", "Target", "IP", "Request"]) {
    assert.ok(src.includes(`>${header}<`), `keeps the ${header} column`);
  }
});

test("the audit-log DTO helper excludes metadata + userAgent by construction", () => {
  const src = readSrc("src/lib/admin/security/audit-log-ui.ts");
  // The Pick<> row type must not name metadata or userAgent.
  assert.ok(!src.includes('"metadata"'), "DTO Pick excludes metadata");
  assert.ok(!src.includes('"userAgent"'), "DTO Pick excludes userAgent");
});

// ---------------------------------------------------------------------------
// Both islands token-driven (no raw hex / inline font-size / inline style)
// ---------------------------------------------------------------------------

for (const rel of [
  "src/components/admin/security/AdminSecurityEventsPanel.tsx",
  "src/components/admin/security/AdminAuditLogPanel.tsx",
  "src/components/admin/security/panel-states.tsx",
]) {
  test(`${rel} is token-driven (no raw hex, no inline font-size/style)`, () => {
    const src = readSrc(rel).replace(/#\d+/g, "");
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), "must not use a raw hex colour");
    assert.ok(!src.includes("fontSize"), "must not set an inline fontSize");
    assert.ok(!src.includes("style={{"), "must not use inline styles");
  });
}

// ---------------------------------------------------------------------------
// security/page.tsx — renders BOTH panels, still gates on securityView
// ---------------------------------------------------------------------------

test("security page mounts both panels and keeps the securityView gate + dynamic", () => {
  const src = readSrc("src/app/admin/security/page.tsx");
  assert.ok(src.includes("AdminSecurityEventsPanel"), "renders the events panel");
  assert.ok(src.includes("AdminAuditLogPanel"), "renders the audit-log panel");
  assert.ok(
    src.includes("requireCapability(CAPABILITIES.securityView"),
    "keeps the securityView capability gate",
  );
  assert.ok(src.includes('export const dynamic = "force-dynamic"'), "stays force-dynamic");
  // Posture StatCards preserved.
  assert.ok(src.includes("Trusted proxy") && src.includes("CSRF same-origin"), "keeps the posture StatCards");
  // The old static server-rendered events table is gone.
  assert.ok(!src.includes("getRecentSecurityEvents"), "no longer fetches events server-side");
});
