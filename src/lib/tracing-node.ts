/**
 * Re-export shim — canonical implementation lives in `@/lib/observability/tracing-node`.
 *
 * @server-only — Must never be imported from a "use client" file.
 * See docs/refactoring.md § REF-076.
 *
 * All existing importers of `@/lib/tracing-node` continue to work without changes.
 * See REF-053 for context.
 */
export { startTracing } from "@/lib/observability/tracing-node";
