/**
 * Observability configuration — logging, tracing, and error reporting (server-only).
 *
 * IMPORTANT: never import from a Client Component.
 */
import { envValue } from "@/lib/runtime-config/env";

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export type LogLevel = "debug" | "info" | "warn" | "error";

/** The configured log level (LOG_LEVEL, default "info"). */
export function logLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
}

// ---------------------------------------------------------------------------
// Observability — OpenTelemetry tracing (RW-032)
// ---------------------------------------------------------------------------

/** Resolved tracing config when tracing is enabled (else `null`). */
export type TracingConfig = {
  exporter: "otlp" | "console";
  endpoint: string | null;
  serviceName: string;
  environment: string;
  serviceVersion: string;
};

function truthyEnv(name: string): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/** The release/version string used for traces and error reports. */
export function appVersion(): string {
  return (
    envValue("APP_VERSION") ??
    envValue("npm_package_version") ??
    "0.0.0"
  );
}

/**
 * Resolve the tracing configuration following the graceful-fallback convention.
 * Tracing is OFF (returns `null`) unless explicitly enabled.
 */
export function tracingConfig(): TracingConfig | null {
  const endpoint =
    envValue("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") ??
    envValue("OTEL_EXPORTER_OTLP_ENDPOINT");
  const flagEnabled = truthyEnv("TRACING_ENABLED");
  if (!endpoint && !flagEnabled) return null;
  return {
    exporter: endpoint ? "otlp" : "console",
    endpoint,
    serviceName: envValue("OTEL_SERVICE_NAME") ?? "readwise",
    environment: process.env.NODE_ENV ?? "development",
    serviceVersion: appVersion(),
  };
}

/** Whether OpenTelemetry tracing is enabled for this process. */
export function isTracingConfigured(): boolean {
  return tracingConfig() !== null;
}

// ---------------------------------------------------------------------------
// Observability — error aggregation (RW-033)
// ---------------------------------------------------------------------------

/**
 * The configured error-aggregation provider (ERROR_REPORTING_PROVIDER, default "log").
 */
export function errorReportingProvider(): string {
  return (envValue("ERROR_REPORTING_PROVIDER") ?? "log").toLowerCase();
}

/**
 * Number of occurrences of a single error fingerprint that triggers the
 * high-frequency alert hook (ERROR_ALERT_THRESHOLD, default 10).
 */
export function errorAlertThreshold(): number {
  const v = parseInt(process.env.ERROR_ALERT_THRESHOLD ?? "", 10);
  return Number.isInteger(v) && v > 0 ? v : 10;
}
