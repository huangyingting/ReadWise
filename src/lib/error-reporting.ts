/**
 * Backend-agnostic error aggregation (RW-033).
 *
 * A single seam — {@link captureError} — that every server/worker/client error
 * path funnels through. It:
 *   - computes a stable {@link fingerprint} (name + normalized message + top
 *     stack frame) so the same error groups together across occurrences,
 *   - enriches with release/version, environment, route, request id and (when
 *     safe) user id, pulling the request id from the ambient logger context,
 *   - REDACTS content: it never logs article text, selected text, or prompts,
 *     and scrubs obvious PII/secret-looking values from the supplied context,
 *   - increments a low-cardinality metric, and
 *   - fires a pluggable high-frequency/high-severity ALERT hook past a
 *     threshold.
 *
 * It is provider-agnostic: the DEFAULT sink writes a structured `error.captured`
 * log line (so errors land in the same searchable logs as everything else) and
 * a real provider (Sentry/OTLP/etc.) can be plugged in via {@link setErrorSink}
 * without touching any call site. NO provider dependency is hard-added.
 */
import { createLogger, getRequestContext } from "@/lib/logger";
import { recordErrorCaptured } from "@/lib/metrics";
import {
  appVersion,
  errorAlertThreshold,
  errorReportingProvider,
} from "@/lib/config";

const log = createLogger("errors");

export type ErrorSource = "server" | "client" | "worker" | "unknown";
export type ErrorSeverity = "fatal" | "error" | "warning" | "info";

/** Caller-supplied context. Values are scrubbed before they are ever logged. */
export type ErrorContext = {
  source?: ErrorSource;
  severity?: ErrorSeverity;
  /** Route group (low cardinality) the error occurred on, when known. */
  route?: string;
  /** Override the request id (defaults to the ambient logger context). */
  requestId?: string;
  /** User id — included only because it is an opaque id, never PII. */
  userId?: string;
  /** Arbitrary low-risk extra fields; scrubbed for PII/secret-looking values. */
  extra?: Record<string, unknown>;
};

/** The normalized, redacted record handed to a sink + returned to callers. */
export type CapturedError = {
  fingerprint: string;
  name: string;
  message: string;
  stack?: string;
  source: ErrorSource;
  severity: ErrorSeverity;
  route?: string;
  requestId?: string;
  userId?: string;
  release: string;
  environment: string;
  /** How many times this fingerprint has been seen this process lifetime. */
  occurrences: number;
  /** True when this occurrence crossed the alert threshold. */
  alert: boolean;
  extra?: Record<string, unknown>;
  timestamp: string;
};

/** A pluggable error sink. The default writes a structured log + metric. */
export type ErrorSink = (record: CapturedError) => void;

/** A pluggable alert hook fired when a fingerprint is frequent/high severity. */
export type AlertHook = (record: CapturedError) => void;

// ---- redaction -----------------------------------------------------------

/**
 * Keys whose VALUES must never be logged — content + secrets. Matched
 * case-insensitively as substrings so e.g. `articleContent`, `selected_text`,
 * `prompt`, `apiKey`, `authorization` are all caught.
 */
const SENSITIVE_KEY_PATTERNS = [
  "content",
  "selection",
  "selected",
  "prompt",
  "completion",
  "message_body",
  "body",
  "text",
  "password",
  "secret",
  "token",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "session",
  "credential",
];

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
}

/** Mask emails and long token-like strings inside a free-text string value. */
function scrubString(value: string): string {
  return value
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[token]");
}

/**
 * Scrub an arbitrary `extra` bag: drop sensitive keys entirely, mask strings,
 * cap value length, and never recurse into nested objects (replace with a
 * placeholder) so we cannot accidentally serialize a large content payload.
 */
export function scrubContext(
  extra: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!extra) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extra)) {
    if (isSensitiveKey(key)) {
      out[key] = "[redacted]";
      continue;
    }
    if (value === null || value === undefined) {
      out[key] = value;
    } else if (typeof value === "string") {
      out[key] = scrubString(value).slice(0, 200);
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else {
      // Never serialize nested structures — could carry content.
      out[key] = "[object]";
    }
  }
  return out;
}

// ---- fingerprinting ------------------------------------------------------

function normalizeMessage(message: string): string {
  return scrubString(message)
    // Collapse digits + hex ids so "article abc123 failed" groups with "def456".
    .replace(/0x[0-9a-f]+/gi, "0x*")
    .replace(/\b[0-9a-f]{8,}\b/gi, "*")
    .replace(/\d+/g, "*")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/** Extract the top "at ..." stack frame (file/function), location only. */
function topFrame(stack: string | undefined): string {
  if (!stack) return "";
  const line = stack
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("at "));
  if (!line) return "";
  // Drop absolute path noise + line:col numbers; keep function + file basename.
  return line
    .replace(/\(?(?:[A-Za-z]:)?\/[^)]*\/([^/):]+)(:\d+:\d+)?\)?/, "$1")
    .replace(/:\d+:\d+/g, "")
    .slice(0, 200);
}

/**
 * Stable group key: error name + normalized message + top stack frame. Numbers
 * and ids are masked in the message so occurrences with varying ids collapse.
 */
export function fingerprint(error: { name?: string; message?: string; stack?: string }): string {
  const name = (error.name || "Error").slice(0, 60);
  const message = normalizeMessage(error.message || "");
  const frame = topFrame(error.stack);
  return `${name}|${message}|${frame}`;
}

// ---- sinks + alert hook --------------------------------------------------

/** Counts occurrences per fingerprint for the alert threshold (this process). */
const occurrenceCounts = new Map<string, number>();

const defaultSink: ErrorSink = (record) => {
  log.error("error.captured", {
    fingerprint: record.fingerprint,
    errorName: record.name,
    errorMessage: record.message,
    stack: record.stack,
    source: record.source,
    severity: record.severity,
    route: record.route,
    userId: record.userId,
    release: record.release,
    environment: record.environment,
    occurrences: record.occurrences,
    provider: errorReportingProvider(),
    ...record.extra,
  });
};

const defaultAlertHook: AlertHook = (record) => {
  log.error("error.alert", {
    fingerprint: record.fingerprint,
    errorName: record.name,
    severity: record.severity,
    occurrences: record.occurrences,
    threshold: errorAlertThreshold(),
    route: record.route,
  });
};

let activeSink: ErrorSink = defaultSink;
let activeAlertHook: AlertHook = defaultAlertHook;

/**
 * Replace the error sink (e.g. forward to Sentry/OTLP). Returns a restore
 * function. The default writes a structured `error.captured` log + metric.
 */
export function setErrorSink(sink: ErrorSink): () => void {
  const previous = activeSink;
  activeSink = sink;
  return () => {
    activeSink = previous;
  };
}

/** Replace the high-frequency/high-severity alert hook. Returns a restore fn. */
export function setAlertHook(hook: AlertHook): () => void {
  const previous = activeAlertHook;
  activeAlertHook = hook;
  return () => {
    activeAlertHook = previous;
  };
}

/** Clears per-fingerprint occurrence counters (used by tests). */
export function resetErrorReporting(): void {
  occurrenceCounts.clear();
}

function shouldAlert(record: Omit<CapturedError, "alert">): boolean {
  if (record.severity === "fatal") return true;
  return record.occurrences >= errorAlertThreshold();
}

// ---- capture -------------------------------------------------------------

/**
 * Capture an error: group it, enrich + redact it, emit it to the active sink,
 * increment the metric, and fire the alert hook when warranted. NEVER throws —
 * a failure inside reporting must not mask the original error.
 */
export function captureError(
  error: unknown,
  context: ErrorContext = {},
): CapturedError {
  const err =
    error instanceof Error
      ? error
      : new Error(typeof error === "string" ? error : "Non-error thrown");
  const ambient = getRequestContext();
  const print = fingerprint(err);
  const occurrences = (occurrenceCounts.get(print) ?? 0) + 1;
  occurrenceCounts.set(print, occurrences);

  const base: Omit<CapturedError, "alert"> = {
    fingerprint: print,
    name: err.name || "Error",
    message: scrubString(err.message || "").slice(0, 500),
    stack: err.stack ? scrubString(err.stack).slice(0, 4000) : undefined,
    source: context.source ?? "unknown",
    severity: context.severity ?? "error",
    route: context.route ?? ambient?.path,
    requestId: context.requestId ?? ambient?.requestId,
    userId: context.userId ?? ambient?.userId,
    release: appVersion(),
    environment: process.env.NODE_ENV ?? "development",
    occurrences,
    extra: scrubContext(context.extra),
    timestamp: new Date().toISOString(),
  };
  const alert = shouldAlert(base);
  const record: CapturedError = { ...base, alert };

  try {
    recordErrorCaptured({
      source: record.source,
      severity: record.severity,
      alert,
    });
  } catch {
    // metrics must never break capture
  }
  try {
    activeSink(record);
  } catch {
    // a broken sink must never mask the original error
  }
  if (alert) {
    try {
      activeAlertHook(record);
    } catch {
      // alerting is best-effort
    }
  }
  return record;
}
