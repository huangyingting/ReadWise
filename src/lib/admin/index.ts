/**
 * Admin service layer — barrel re-export.
 *
 * Sub-modules:
 *   overview  — system stats ({@link getAdminOverview}, {@link statusBadgeVariant})
 *   tags      — tag listing, rename, merge, delete
 *   jobs      — job dashboard, retry/cancel/archive (re-exports from @/lib/jobs/admin-*)
 *   articles/ — article admin schemas and ops (existing sub-directory)
 */
export * from "./overview";
export * from "./tags";
export * from "./jobs";
