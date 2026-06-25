/**
 * Security and error metrics recorders.
 *
 * Actor ids, IPs, request ids, and free-form metadata are NOT labels — they
 * live in the structured log line for correlation (see error-reporting.ts and
 * security/events.ts).
 */

import { incCounter, statusClass } from "@/lib/metrics/registry";

/**
 * Records a captured application error (RW-033). Labels are low-cardinality on
 * purpose: `source` (server/client/worker), `severity`, and an `alert` flag set
 * when the error fingerprint crossed the high-frequency alert threshold. The
 * fingerprint itself is NOT a label (unbounded) — it lives in the structured
 * `error.captured` log line for correlation.
 */
export function recordErrorCaptured(input: {
  source: string;
  severity: string;
  alert?: boolean;
}): void {
  incCounter("readwise_errors_captured_total", "Captured application errors by source and severity.", {
    source: input.source,
    severity: input.severity,
    alert: input.alert ? "true" : "false",
  });
}

/**
 * Records a security-relevant event (RW-029). Labels are intentionally
 * low-cardinality: the event `type` (e.g. auth.forbidden, rate_limit.exceeded),
 * `severity`, an HTTP `status_class` when known, and an `alert` flag set when
 * the event was escalated through the alert seam. Actor ids, IPs, request ids,
 * and free-form metadata are NOT labels — they live in the structured
 * `security.event` log line for correlation.
 */
export function recordSecurityEventMetric(input: {
  type: string;
  severity: string;
  status?: number;
  alert?: boolean;
}): void {
  incCounter("readwise_security_events_total", "Security-relevant events by type and severity.", {
    type: input.type,
    severity: input.severity,
    status_class: input.status !== undefined ? statusClass(input.status) : "none",
    alert: input.alert ? "true" : "false",
  });
}
