/**
 * Backward-compatible re-export shim (REF-052 — Issue #489).
 * Implementation has moved to `@/lib/account-lifecycle`.
 *   member detail read model → @/lib/account-lifecycle/member-detail
 *   support commands         → @/lib/account-lifecycle/support-commands
 */
export * from "@/lib/account-lifecycle/member-detail";
export * from "@/lib/account-lifecycle/support-commands";
