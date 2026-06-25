/**
 * Analytics event stream package — public barrel (REF-049).
 *
 * Stable import path: `@/lib/analytics/events`
 *
 * Re-exports:
 *   - Event type catalog + schema version  (catalog.ts)
 *   - Property sanitization                (sanitize.ts)
 *   - Event stream writer                  (writer.ts)
 *   - Retention / GDPR erasure             (retention.ts)
 */
export * from "@/lib/analytics/events/catalog";
export * from "@/lib/analytics/events/sanitize";
export * from "@/lib/analytics/events/writer";
export * from "@/lib/analytics/events/retention";
