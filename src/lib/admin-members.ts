/**
 * Backward-compatible re-export shim (REF-052 — Issue #489).
 * Implementation has moved to `@/lib/account-lifecycle`.
 *   member list    → @/lib/account-lifecycle/member-list
 *   member commands → @/lib/account-lifecycle/member-commands
 */
export * from "@/lib/account-lifecycle/member-list";
export * from "@/lib/account-lifecycle/member-commands";
