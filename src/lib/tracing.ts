/**
 * Re-export shim — canonical implementation lives in `@/lib/observability/tracing`.
 *
 * All existing importers of `@/lib/tracing` continue to work without changes.
 * See REF-053 for context.
 */
export type { Attributes, Span } from "@opentelemetry/api";
export {
  TRACER_NAME,
  tracer,
  sanitizeAttributes,
  withSpan,
  startChildSpan,
  setSpanAttributes,
  recordSpanError,
  activeTraceId,
} from "@/lib/observability/tracing";
