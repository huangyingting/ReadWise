/**
 * Observability package — public barrel (REF-053).
 *
 * Provides a cohesive surface for the ReadWise observability stack:
 *   - Structured logging with request context    → logger
 *   - Error capture, fingerprinting, redaction   → errors
 *   - OpenTelemetry span helpers (API-only)      → tracing
 *   - SLO catalog and evaluation                 → slo
 *
 * The Node-only SDK bootstrap (`tracing-node`) is NOT re-exported here because
 * it must only be imported inside a `process.env.NEXT_RUNTIME === "nodejs"`
 * guard to stay out of Edge/Client bundles. Import it directly:
 *
 *   import { startTracing } from "@/lib/observability/tracing-node"
 *
 * Import domain-specific helpers from this barrel or from the focused
 * submodules above.
 */

// Logger + request context
export type {
  LogLevel,
  RequestContext,
  StructuredLogger,
} from "./logger";
export {
  runWithRequestContext,
  getRequestContext,
  getRequestId,
  setRequestContext,
  createLogger,
} from "./logger";

// Error capture
export type {
  ErrorSource,
  ErrorSeverity,
  ErrorContext,
  CapturedError,
  ErrorSink,
  AlertHook,
} from "./errors";
export {
  scrubContext,
  fingerprint,
  setErrorSink,
  setAlertHook,
  resetErrorReporting,
  captureError,
} from "./errors";

// Tracing helpers (OTel API — safe to import anywhere)
export type { Span, Attributes } from "@opentelemetry/api";
export {
  TRACER_NAME,
  tracer,
  sanitizeAttributes,
  withSpan,
  startChildSpan,
  setSpanAttributes,
  recordSpanError,
  activeTraceId,
} from "./tracing";

// SLO catalog and evaluation
export type {
  SliCategory,
  SliKind,
  SliMeasurement,
  SliDefinition,
  SliStatus,
  SliEvaluation,
  SloReport,
} from "./slo";
export { SLI_CATALOG, evaluateSlos } from "./slo";
