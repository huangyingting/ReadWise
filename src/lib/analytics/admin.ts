/**
 * Admin analytics subpackage — stable public path: `@/lib/analytics/admin`.
 *
 * Re-exports admin dashboard aggregation from `@/lib/admin-analytics`. This
 * facade keeps the canonical import path under the analytics namespace while
 * the underlying module remains at its current location.
 *
 * TODO(REF-049 follow-up): move `admin-analytics.ts` under
 * `@/lib/analytics/admin/` and delete this re-export barrel.
 */
export * from "@/lib/admin-analytics";