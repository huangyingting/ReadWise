/**
 * Tenant/classroom analytics subpackage — stable public path: `@/lib/analytics/tenant`.
 *
 * Re-exports tenant-aware analytics and privacy rules from
 * `@/lib/tenant-analytics`. This facade keeps the canonical import path under
 * the analytics namespace while the underlying module remains at its current
 * location.
 *
 * TODO(REF-049 follow-up): move `tenant-analytics.ts` under
 * `@/lib/analytics/tenant/` and delete this re-export barrel.
 */
export * from "@/lib/tenant-analytics";