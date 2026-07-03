/**
 * Structured logging + request tracing (US-029).
 *
 * A single place that emits JSON log lines and carries a *request-scoped*
 * context (request id, user id, method, path) via {@link AsyncLocalStorage}.
 * Any code running inside {@link runWithRequestContext} — route handlers and
 * the library helpers they call — can log through {@link createLogger} (or read
 * {@link getRequestContext}) and automatically inherit that context WITHOUT
 * threading it through every function signature.
 *
 * Part of the observability package (REF-053). This is the canonical
 * implementation.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { logLevel, type LogLevel } from "@/lib/runtime-config/observability";

export type { LogLevel };

/** Per-request ambient context merged into every log line. */
export type RequestContext = {
  requestId: string;
  userId?: string;
  method?: string;
  path?: string;
};

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with the given request context bound for its entire async lifetime. */
export function runWithRequestContext<T>(
  context: RequestContext,
  fn: () => T,
): T {
  return storage.run(context, fn);
}

/** The current request context, or `undefined` outside a request. */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** The current request id, if any. */
export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/**
 * Mutate the active request context (e.g. attach the user id once auth runs).
 * No-op when called outside a request scope.
 */
export function setRequestContext(values: Partial<RequestContext>): void {
  const store = storage.getStore();
  if (store) Object.assign(store, values);
}

export type StructuredLogger = {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
};

const order: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function minLevel(): LogLevel {
  return logLevel();
}

function shouldEmit(level: LogLevel, threshold: number): boolean {
  return order[level] >= threshold;
}

function buildLogLine(
  scope: string,
  level: LogLevel,
  message: string,
  base: Record<string, unknown>,
  meta?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ts: new Date().toISOString(),
    level,
    scope,
    message,
    ...getRequestContext(),
    ...base,
    ...meta,
  };
}

function writeLogLine(level: LogLevel, line: string): void {
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/**
 * Build a logger bound to a `scope` (e.g. "api", "worker"). Each call merges:
 * the ambient request context, then the logger's `base` fields, then the
 * per-call `meta`. Lines below `LOG_LEVEL` (default "info") are dropped.
 */
export function createLogger(
  scope: string,
  base: Record<string, unknown> = {},
): StructuredLogger {
  const threshold = order[minLevel()];
  const emit =
    (level: LogLevel) =>
    (message: string, meta?: Record<string, unknown>) => {
      if (!shouldEmit(level, threshold)) return;
      writeLogLine(level, JSON.stringify(buildLogLine(scope, level, message, base, meta)));
    };
  return {
    debug: emit("debug"),
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
  };
}
