/**
 * Backward-compatibility re-export for `@/lib/analytics` (REF-049).
 *
 * The analytics event stream writer has moved to `@/lib/analytics/events` and
 * its sub-modules. This shim keeps existing `import … from "@/lib/analytics"`
 * call sites working without modification.
 *
 * @deprecated Prefer importing directly from `@/lib/analytics/events` (or its
 * sub-modules) for new code:
 *   - constants/types  → `@/lib/analytics/events/catalog`
 *   - sanitization     → `@/lib/analytics/events/sanitize`
 *   - event writer     → `@/lib/analytics/events/writer`
 *   - retention/erasure → `@/lib/analytics/events/retention`
 */
export * from "@/lib/analytics/events";
