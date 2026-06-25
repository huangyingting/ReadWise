/**
 * Re-export shim — canonical implementation lives in `@/lib/observability/errors`.
 *
 * All existing importers of `@/lib/error-reporting` continue to work without changes.
 * See REF-053 for context.
 */
export type {
  ErrorSource,
  ErrorSeverity,
  ErrorContext,
  CapturedError,
  ErrorSink,
  AlertHook,
} from "@/lib/observability/errors";
export {
  scrubContext,
  fingerprint,
  setErrorSink,
  setAlertHook,
  resetErrorReporting,
  captureError,
} from "@/lib/observability/errors";
