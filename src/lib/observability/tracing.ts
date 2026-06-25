/**
 * OpenTelemetry tracing helpers (RW-032).
 *
 * Thin, dependency-light wrappers around `@opentelemetry/api`. The OTel API is
 * a *no-op* until an SDK is registered (see `instrumentation.ts`), so every
 * helper here is safe to call even when tracing is disabled — `trace.getTracer`
 * returns a no-op tracer and spans become cheap no-ops. Nothing in a request or
 * job path needs to branch on whether tracing is configured.
 *
 * PRIVACY: span attributes must never contain article content, selected text,
 * prompts, or other user content. Helpers here only set low-cardinality
 * metadata (feature names, route groups, ids, status) and the ambient request
 * id so traces correlate with the structured logs.
 *
 * Part of the observability package (REF-053). This is the canonical
 * implementation; `@/lib/tracing` is a re-export shim for backward compatibility.
 */
import {
  SpanStatusCode,
  context as otelContext,
  trace,
  type Attributes,
  type AttributeValue,
  type Span,
} from "@opentelemetry/api";
import { getRequestId } from "./logger";

/** Service/instrumentation scope name used for every span we create. */
export const TRACER_NAME = "readwise";

/** The shared tracer. No-op until an SDK is registered in instrumentation.ts. */
export function tracer() {
  return trace.getTracer(TRACER_NAME);
}

/**
 * Attribute keys that are KNOWN-SAFE to put on spans. Everything we set goes
 * through {@link sanitizeAttributes}, which drops any key not on this list so a
 * careless caller can never leak content (prompts/article text/selection) into
 * a trace. Keep this list low-cardinality and content-free.
 */
const SAFE_ATTRIBUTE_KEYS = new Set<string>([
  "readwise.request_id",
  "readwise.user_id",
  "readwise.feature",
  "readwise.route",
  "readwise.method",
  "readwise.status",
  "readwise.outcome",
  "readwise.article_id",
  "readwise.job_type",
  "readwise.attempt",
  "readwise.provider",
  "readwise.host",
  "readwise.kind",
  "readwise.duration_ms",
  "readwise.published",
  "readwise.count",
  // Standard OTel semantic keys callers may pass through.
  "http.request.method",
  "http.response.status_code",
  "url.path",
  "server.address",
]);

/**
 * Keep only allow-listed keys with primitive (string/number/boolean) values.
 * This is the privacy guard: unknown keys or object/array values are dropped.
 */
export function sanitizeAttributes(attrs?: Attributes): Attributes {
  const safe: Attributes = {};
  if (!attrs) return safe;
  for (const [key, value] of Object.entries(attrs)) {
    if (!SAFE_ATTRIBUTE_KEYS.has(key)) continue;
    if (value === undefined || value === null) continue;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      safe[key] = value as AttributeValue;
    }
  }
  return safe;
}

/** The current ambient request id as a span attribute (when in a request). */
function requestIdAttributes(): Attributes {
  const requestId = getRequestId();
  return requestId ? { "readwise.request_id": requestId } : {};
}

/**
 * Run `fn` inside a new span named `name` with the (sanitized) `attrs`. The
 * span records exceptions + sets an ERROR status when `fn` throws, then ends in
 * a `finally`. With tracing disabled this is a thin pass-through that still
 * returns `fn`'s value — i.e. a safe no-op.
 */
export async function withSpan<T>(
  name: string,
  attrs: Attributes,
  fn: (span: Span) => Promise<T> | T,
): Promise<T> {
  const safeAttrs = { ...requestIdAttributes(), ...sanitizeAttributes(attrs) };
  return tracer().startActiveSpan(name, { attributes: safeAttrs }, async (span) => {
    try {
      const result = await fn(span);
      return result;
    } catch (err) {
      recordSpanError(span, err);
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Start a child span as the active span and return it WITHOUT managing its
 * lifecycle. The caller MUST call `span.end()` (use try/finally). Prefer
 * {@link withSpan} unless you need manual control (e.g. ending in a callback).
 */
export function startChildSpan(name: string, attrs?: Attributes): Span {
  const safeAttrs = { ...requestIdAttributes(), ...sanitizeAttributes(attrs) };
  return tracer().startSpan(name, { attributes: safeAttrs }, otelContext.active());
}

/** Set additional (sanitized) attributes on an existing span. */
export function setSpanAttributes(span: Span, attrs: Attributes): void {
  span.setAttributes(sanitizeAttributes(attrs));
}

/** Record an exception + ERROR status on a span (message only, no content). */
export function recordSpanError(span: Span, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof Error) span.recordException(err);
  span.setStatus({ code: SpanStatusCode.ERROR, message });
}

/** The active trace id (32-hex) for log/trace correlation, or undefined. */
export function activeTraceId(): string | undefined {
  const span = trace.getActiveSpan();
  const id = span?.spanContext().traceId;
  // OTel reports an all-zero trace id when no SDK/sampling is active.
  return id && /[1-9a-f]/.test(id) ? id : undefined;
}
