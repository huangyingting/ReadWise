/**
 * Re-export shim — canonical implementation lives in `@/lib/observability/logger`.
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
