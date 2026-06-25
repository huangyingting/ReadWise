/**
 * Product analytics query subpackage — stable public path: `@/lib/analytics/product`.
 *
 * Re-exports the full analytics query subsystem from `@/lib/analytics/queries`
 * (overview, funnel, retention, segments, range, repository). Kept as a stable
 * subpackage facade so call sites can import from either path.
 */
export * from "@/lib/analytics/queries";