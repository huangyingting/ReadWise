/**
 * Re-export shim — canonical implementation lives in `@/lib/observability/logger`.
 *
 * @server-only — Must never be imported from a "use client" file.
 * See docs/refactoring.md § REF-076.
 *
 * All existing importers of `@/lib/logger` continue to work without changes.
 * See REF-053 for context.
 */
export type { LogLevel, RequestContext, StructuredLogger } from "@/lib/observability/logger";
export {
  runWithRequestContext,
  getRequestContext,
  getRequestId,
  setRequestContext,
  createLogger,
} from "@/lib/observability/logger";
