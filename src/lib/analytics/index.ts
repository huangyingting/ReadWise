/**
 * Analytics domain namespace (REF-049).
 *
 * Aggregates all analytics subpackages as named exports:
 *   - `analytics.events`  — event stream writer, catalog, sanitizer, retention
 *   - `analytics.product` — funnel / activation / retention / feature analytics
 *   - `analytics.admin`   — admin dashboard aggregation
 *   - `analytics.learner` — learner-facing activity analytics
 *   - `analytics.tenant`  — tenant / classroom analytics and privacy rules
 */
export * as events from "@/lib/analytics/events";
export * as product from "@/lib/analytics/product";
export * as admin from "@/lib/analytics/admin";
export * as learner from "@/lib/analytics/learner";
export * as tenant from "@/lib/analytics/tenant";