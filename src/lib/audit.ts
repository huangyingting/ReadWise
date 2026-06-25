/**
 * Backward-compatible re-export shim (REF-037).
 * Implementation has moved to `@/lib/security/audit`.
 *
 * @server-only — Must never be imported from a "use client" file.
 * See docs/refactoring.md § REF-076.
 */
export * from "@/lib/security/audit";
