/**
 * Security event monitoring & alerting (RW-029).
 *
 * A single seam — {@link recordSecurityEvent} — that every security-relevant
 * signal funnels through: repeated 401/403 responses, rate-limit 429 hits,
 * blocked cross-site (CSRF) requests, admin mutations, failed scraper/imports,
 * and suspicious lookup volume. Each event:
 *
 *   - emits a structured `security.event` log line (carrying the ambient
 *     request id, the actor, route, status, and normalized client IP),
 *   - increments a low-cardinality metric ({@link recordSecurityEventMetric}),
 *   - is appended to an in-memory ring buffer surfaced to the admin endpoint
 *     `GET /api/admin/security/events` (no new DB table — provider-agnostic),
 *   - and, for HIGH/CRITICAL severity OR a detected SPIKE (the same event type
 *     for the same actor/IP crossing a threshold within a rolling window), is
 *     routed through the existing {@link captureError} alert seam so deployments
 *     get alerts without any new alerting code.
 *
 * REDACTION: metadata is scrubbed via the same {@link scrubContext} used by
 * error aggregation — article text, selected text, prompts, tokens, cookies,
 * and other secrets can NEVER reach a security event.
 *
 * INSTANCE-LOCAL LIMITATION (R2CI-9):
 *   The in-memory ring buffer and the synchronous spike threshold check are
 *   per-process. In a multi-instance deployment, `GET /api/admin/security/events`
 *   only reflects the events seen by the responding instance, and a coordinated
 *   attack spread across N instances may not trip the threshold on any single
 *   node. Cross-instance spike counts ARE written to the shared DB store
 *   (best-effort, fire-and-forget via the fixed-window counter) for future
 *   cluster-level aggregation, but the immediate alert gate remains local.
 *   A future issue (#622) will add a cluster-level spike reader. The admin UI
 *   should surface this note alongside the event list.
 */
import { createLogger, getRequestContext } from "@/lib/observability/logger";
import { recordSecurityEventMetric } from "@/lib/metrics";
import { captureError, scrubContext } from "@/lib/observability/errors";
import {
  securityEventAlertThreshold,
  securityEventBufferSize,
  securityEventWindowMs,
} from "@/lib/runtime-config/security";
import {
  observeFixedWindow,
  resetFixedWindowCounters,
} from "@/lib/security/fixed-window-counter";

const log = createLogger("security");

/** Well-known security event types (extensible — any string is accepted). */
export const SECURITY_EVENT_TYPES = {
  unauthorized: "auth.unauthorized",
  forbidden: "auth.forbidden",
  adminAccessDenied: "auth.admin_denied",
  rateLimited: "rate_limit.exceeded",
  csrfBlocked: "csrf.blocked",
  adminMutation: "admin.mutation",
  importFailed: "import.failed",
  importBlocked: "import.blocked",
  suspiciousLookup: "lookup.suspicious_volume",
} as const;

export type SecurityEventType =
  | (typeof SECURITY_EVENT_TYPES)[keyof typeof SECURITY_EVENT_TYPES]
  | (string & {});

export type SecuritySeverity = "low" | "medium" | "high" | "critical";

export type SecurityEventInput = {
  /** A stable, low-cardinality event type (see {@link SECURITY_EVENT_TYPES}). */
  type: SecurityEventType;
  /** Severity — high/critical always escalate through the alert seam. */
  severity: SecuritySeverity;
  /** Route group the event occurred on (low cardinality), when known. */
  route?: string;
  /** Associated HTTP status, when applicable. */
  status?: number;
  /** Opaque actor (user) id — never PII. */
  actorId?: string | null;
  /** Normalized client IP from {@link "@/lib/security/client-ip"}. */
  ip?: string | null;
  /** Override the request id (defaults to the ambient logger context). */
  requestId?: string;
  /** Safe, low-risk extra fields. Scrubbed for content/PII/secrets. */
  meta?: Record<string, unknown>;
};

/** The normalized, redacted record stored in the ring buffer + returned. */
export type SecurityEventRecord = {
  type: string;
  severity: SecuritySeverity;
  route?: string;
  status?: number;
  actorId?: string;
  ip?: string;
  requestId?: string;
  /** How many of this (type + actor/IP) were seen in the current window. */
  count: number;
  /** True when the event was escalated through the alert seam. */
  alert: boolean;
  meta?: Record<string, unknown>;
  timestamp: string;
};

function bumpSpike(key: string, nowMs: number, windowMs: number): number {
  return observeFixedWindow({ key: `spike:${key}`, nowMs, windowMs });
}

// ---- recent-event ring buffer --------------------------------------------

const ring: SecurityEventRecord[] = [];

function pushRing(record: SecurityEventRecord): void {
  ring.push(record);
  const max = securityEventBufferSize();
  while (ring.length > max) ring.shift();
}

/** Recent security events, newest first (bounded by the ring buffer size). */
export function getRecentSecurityEvents(limit = 100): SecurityEventRecord[] {
  const slice = limit > 0 ? ring.slice(-limit) : ring.slice();
  return slice.reverse();
}

/** Clears the ring buffer + spike counters (used by tests). */
export function resetSecurityEvents(): void {
  ring.length = 0;
  resetFixedWindowCounters();
}

// ---- severity mapping ----------------------------------------------------

const SEVERITY_RANK: Record<SecuritySeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

/** Map a security severity (plus spike flag) to an error-reporting severity. */
function toErrorSeverity(severity: SecuritySeverity, spike: boolean): "fatal" | "error" {
  if (severity === "critical") return "fatal";
  // A detected spike of any severity is escalated to always-alert.
  if (spike) return "fatal";
  return "error";
}

function isHighSeverity(severity: SecuritySeverity): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK.high;
}

function emitSecurityEventLog(record: SecurityEventRecord, highSeverity: boolean): void {
  const line = {
    securityType: record.type,
    severity: record.severity,
    route: record.route,
    status: record.status,
    actorId: record.actorId,
    ip: record.ip,
    count: record.count,
    alert: record.alert,
    ...record.meta,
  };
  if (highSeverity) log.error("security.event", line);
  else log.warn("security.event", line);
}

function recordMetric(record: SecurityEventRecord): void {
  try {
    recordSecurityEventMetric({
      type: record.type,
      severity: record.severity,
      status: record.status,
      alert: record.alert,
    });
  } catch {
    // metrics must never break monitoring
  }
}

function pushRecentSecurityEvent(record: SecurityEventRecord): void {
  try {
    pushRing(record);
  } catch {
    // best-effort
  }
}

function escalateSecurityEvent(
  record: SecurityEventRecord,
  spike: boolean,
  escalation: Error,
): void {
  try {
    escalation.name = "SecurityEvent";
    captureError(escalation, {
      source: "server",
      severity: toErrorSeverity(record.severity, spike),
      machineReason: "security_event",
      route: record.route,
      requestId: record.requestId,
      userId: record.actorId,
      extra: {
        securityType: record.type,
        status: record.status,
        ip: record.ip,
        count: record.count,
      },
    });
  } catch {
    // alerting is best-effort
  }
}

// ---- main entry ----------------------------------------------------------

/**
 * Record a security event. NEVER throws — a failure inside monitoring must not
 * break the request path. Returns the normalized record (handy for tests).
 */
export function recordSecurityEvent(input: SecurityEventInput): SecurityEventRecord {
  const ambient = getRequestContext();
  const nowMs = Date.now();

  const actorId = input.actorId ?? ambient?.userId ?? undefined;
  const ip = input.ip ?? undefined;
  const requestId = input.requestId ?? ambient?.requestId ?? undefined;
  const route = input.route ?? ambient?.path ?? undefined;
  const meta = scrubContext(input.meta);

  // Spike detection: same type for the same actor/IP within the window.
  const spikeKey = `${input.type}|${actorId ?? ip ?? "anon"}`;
  const count = bumpSpike(spikeKey, nowMs, securityEventWindowMs());
  const isSpike = count >= securityEventAlertThreshold();
  const isHigh = isHighSeverity(input.severity);
  const alert = isHigh || isSpike;

  const record: SecurityEventRecord = {
    type: input.type,
    severity: input.severity,
    route,
    status: input.status,
    actorId,
    ip,
    requestId,
    count,
    alert,
    meta,
    timestamp: new Date(nowMs).toISOString(),
  };

  // 1) Structured log (level scales with severity).
  emitSecurityEventLog(record, isHigh);

  // 2) Metric.
  recordMetric(record);

  // 3) Ring buffer.
  pushRecentSecurityEvent(record);

  // 4) Escalate HIGH/CRITICAL severity or a detected spike through the existing
  //    error-aggregation alert seam (reuses captureError fingerprinting/alerts).
  if (alert) {
    const escalation = new Error(
      `security ${record.type} (${record.severity}) x${record.count}`,
    );
    escalateSecurityEvent(record, isSpike, escalation);
  }

  return record;
}
