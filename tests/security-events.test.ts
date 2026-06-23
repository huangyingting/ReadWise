/**
 * Security event monitoring & alerting (RW-029). Verifies field capture +
 * redaction, the ring buffer, spike/severity escalation through the existing
 * error-aggregation alert seam, the api-handler emission points, and that the
 * admin endpoint is admin-gated.
 */
process.env.LOG_LEVEL = "error"; // silence request + security.event logs

import { test, before, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";

type RouteHandler = (req: Request, ctx?: unknown) => Promise<Response>;

let authState: "ok" | "unauth" = "ok";
const session = { user: { id: "user-1", role: "Admin", name: "T", email: "t@e.com" } };

before(() => {
  mock.module("@/lib/api-auth", {
    namedExports: {
      requireSessionApi: async () =>
        authState === "unauth"
          ? { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
          : { session },
      requireAdminApi: async () =>
        authState === "unauth"
          ? { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
          : { session },
    },
  });
  mock.module("@/lib/prisma", { namedExports: { prisma: {} } });
});

const restores: Array<() => void> = [];

beforeEach(async () => {
  authState = "ok";
  delete process.env.SECURITY_EVENT_ALERT_THRESHOLD;
  delete process.env.SECURITY_EVENT_WINDOW_MS;
  const { resetSecurityEvents } = await import("@/lib/security-events");
  const { resetErrorReporting, resetMetrics } = {
    ...(await import("@/lib/error-reporting")),
    ...(await import("@/lib/metrics")),
  };
  resetSecurityEvents();
  resetErrorReporting();
  resetMetrics();
});

afterEach(() => {
  while (restores.length) restores.pop()!();
});

// ---- field capture + redaction -------------------------------------------

test("a 403 event captures the expected fields and redacts sensitive metadata", async () => {
  const { recordSecurityEvent, getRecentSecurityEvents } = await import("@/lib/security-events");

  recordSecurityEvent({
    type: "auth.forbidden",
    severity: "medium",
    status: 403,
    route: "/api/admin/test",
    actorId: "user-9",
    ip: "203.0.113.7",
    meta: {
      method: "DELETE",
      content: "secret article body that must never be logged",
      selectedText: "highlighted phrase",
      note: "ok-to-keep",
    },
  });

  const [event] = getRecentSecurityEvents(1);
  assert.equal(event.type, "auth.forbidden");
  assert.equal(event.severity, "medium");
  assert.equal(event.status, 403);
  assert.equal(event.route, "/api/admin/test");
  assert.equal(event.actorId, "user-9");
  assert.equal(event.ip, "203.0.113.7");
  assert.equal(event.meta?.method, "DELETE");
  assert.equal(event.meta?.note, "ok-to-keep");
  // Content + selected text are redacted; no article text reaches the event.
  assert.equal(event.meta?.content, "[redacted]");
  assert.equal(event.meta?.selectedText, "[redacted]");
});

test("getRecentSecurityEvents returns newest-first and respects the limit", async () => {
  const { recordSecurityEvent, getRecentSecurityEvents } = await import("@/lib/security-events");
  recordSecurityEvent({ type: "auth.unauthorized", severity: "low", actorId: "a" });
  recordSecurityEvent({ type: "rate_limit.exceeded", severity: "medium", actorId: "b" });
  const events = getRecentSecurityEvents(1);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "rate_limit.exceeded");
});

// ---- metric --------------------------------------------------------------

test("recording an event increments the security metric", async () => {
  const { recordSecurityEvent } = await import("@/lib/security-events");
  const { getMetricsSnapshot } = await import("@/lib/metrics");
  recordSecurityEvent({ type: "auth.forbidden", severity: "medium", status: 403 });
  const point = getMetricsSnapshot().counters.find(
    (candidate) =>
      candidate.name === "readwise_security_events_total" &&
      candidate.labels.type === "auth.forbidden" &&
      candidate.labels.severity === "medium",
  );
  assert.ok(point && point.value >= 1);
});

// ---- escalation through the alert seam -----------------------------------

test("repeated events past the threshold fire the alert hook", async () => {
  process.env.SECURITY_EVENT_ALERT_THRESHOLD = "3";
  process.env.SECURITY_EVENT_WINDOW_MS = "60000";
  const { recordSecurityEvent } = await import("@/lib/security-events");
  const { setAlertHook } = await import("@/lib/error-reporting");

  let alerts = 0;
  restores.push(setAlertHook(() => { alerts += 1; }));

  // Same type + actor → counts toward the spike window.
  recordSecurityEvent({ type: "auth.forbidden", severity: "medium", actorId: "spiky" });
  recordSecurityEvent({ type: "auth.forbidden", severity: "medium", actorId: "spiky" });
  assert.equal(alerts, 0, "below threshold must not alert");
  recordSecurityEvent({ type: "auth.forbidden", severity: "medium", actorId: "spiky" });
  assert.ok(alerts >= 1, "crossing the threshold must fire the alert hook");
});

test("a HIGH severity event is routed through the error-reporting seam", async () => {
  const { recordSecurityEvent } = await import("@/lib/security-events");
  const { setErrorSink } = await import("@/lib/error-reporting");

  const captured: Array<{ name: string; source: string }> = [];
  restores.push(setErrorSink((record) => captured.push(record)));

  const record = recordSecurityEvent({
    type: "import.blocked",
    severity: "high",
    route: "/api/articles/import",
    actorId: "user-1",
  });

  assert.equal(record.alert, true);
  assert.ok(captured.some((c) => c.name === "SecurityEvent" && c.source === "server"));
});

test("a single LOW severity event does not escalate", async () => {
  const { recordSecurityEvent } = await import("@/lib/security-events");
  const { setErrorSink } = await import("@/lib/error-reporting");
  const captured: unknown[] = [];
  restores.push(setErrorSink((record) => captured.push(record)));
  const record = recordSecurityEvent({ type: "auth.unauthorized", severity: "low" });
  assert.equal(record.alert, false);
  assert.equal(captured.length, 0);
});

// ---- api-handler emission points -----------------------------------------

test("an unauthenticated request emits an auth.unauthorized event", async () => {
  authState = "unauth";
  const { createHandler } = await import("@/lib/api-handler");
  const { getRecentSecurityEvents } = await import("@/lib/security-events");
  const handler = createHandler({}, async () => NextResponse.json({ ok: true })) as RouteHandler;

  const res = await handler(new Request("http://app.example/api/secret"));
  assert.equal(res.status, 401);

  const events = getRecentSecurityEvents(10);
  const event = events.find((e) => e.type === "auth.unauthorized");
  assert.ok(event, "should emit auth.unauthorized");
  assert.equal(event?.status, 401);
});

// ---- admin endpoint gating -----------------------------------------------

test("GET /api/admin/security/events requires an admin (403 for non-admin)", async () => {
  authState = "unauth";
  const { GET } = (await import("@/app/api/admin/security/events/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://app.example/api/admin/security/events"));
  assert.equal(res.status, 403);
});

test("GET /api/admin/security/events returns buffered events for an admin", async () => {
  const { recordSecurityEvent } = await import("@/lib/security-events");
  recordSecurityEvent({ type: "rate_limit.exceeded", severity: "medium", status: 429 });

  const { GET } = (await import("@/app/api/admin/security/events/route")) as { GET: RouteHandler };
  const res = await GET(new Request("http://app.example/api/admin/security/events?limit=10"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.events));
  assert.ok(body.events.some((e: { type: string }) => e.type === "rate_limit.exceeded"));
});
