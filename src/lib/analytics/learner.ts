/**
 * Learner analytics subpackage — stable public path: `@/lib/analytics/learner`.
 *
 * Re-exports learner-facing analytics from `@/lib/learner-analytics`. This
 * facade keeps the canonical import path under the analytics namespace while
 * the underlying module remains at its current location.
 *
 * TODO(REF-049 follow-up): move `learner-analytics.ts` under
 * `@/lib/analytics/learner/` and delete this re-export barrel.
 */
export * from "@/lib/learner-analytics";