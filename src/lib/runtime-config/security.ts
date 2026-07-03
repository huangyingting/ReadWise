/**
 * Security configuration — trusted proxy, CSRF, and event monitoring (server-only).
 *
 * IMPORTANT: never import from a Client Component.
 */
import { envValue, positiveIntEnv } from "@/lib/runtime-config/env";

// ---------------------------------------------------------------------------
// Security — trusted proxy / client IP handling (RW-027)
// ---------------------------------------------------------------------------

export type TrustedProxyConfig = {
  hops: number | null;
  list: string[];
  header: string | null;
};

const TRUSTED_APP_ORIGIN_ENVS = [
  "NEXTAUTH_URL",
  "APP_URL",
  "NEXT_PUBLIC_APP_URL",
] as const;
const CSRF_ENFORCE_DISABLED_VALUES = new Set(["false", "0", "off", "no"]);
const SECURITY_EVENT_BUFFER_SIZE_MAX = 2_000;

function optionalNonNegativeIntEnv(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return null;
  const v = parseInt(raw, 10);
  return Number.isInteger(v) && v >= 0 ? v : null;
}

function commaSeparatedList(value: string | null): string[] {
  return value
    ? value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : [];
}

/** Resolved trusted-proxy configuration (env-driven; all strategies optional). */
export function trustedProxyConfig(): TrustedProxyConfig {
  const headerRaw = envValue("TRUSTED_PROXY_HEADER");
  return {
    hops: optionalNonNegativeIntEnv("TRUSTED_PROXY_HOPS"),
    list: commaSeparatedList(envValue("TRUSTED_PROXY_LIST")),
    header: headerRaw ? headerRaw.toLowerCase() : null,
  };
}

/** Whether any trusted-proxy strategy is configured (else soft best-effort). */
export function isTrustedProxyConfigured(): boolean {
  const cfg = trustedProxyConfig();
  return cfg.hops !== null || cfg.list.length > 0 || cfg.header !== null;
}

// ---------------------------------------------------------------------------
// Security — CSRF / same-origin enforcement (RW-028)
// ---------------------------------------------------------------------------

function normalizeOriginValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin.toLowerCase();
  } catch {
    try {
      return new URL(`https://${trimmed}`).origin.toLowerCase();
    } catch {
      return null;
    }
  }
}

function addNormalizedOrigin(out: Set<string>, value: string | null | undefined): void {
  const origin = normalizeOriginValue(value);
  if (origin) out.add(origin);
}

/**
 * Extra origins (beyond the request's own host) allowed to make state-changing
 * API calls. NEXTAUTH_URL / APP_URL / NEXT_PUBLIC_APP_URL are always trusted.
 */
export function csrfAllowedOrigins(): string[] {
  const out = new Set<string>();
  for (const entry of commaSeparatedList(envValue("CSRF_ALLOWED_ORIGINS"))) {
    addNormalizedOrigin(out, entry);
  }
  for (const name of TRUSTED_APP_ORIGIN_ENVS) {
    addNormalizedOrigin(out, envValue(name));
  }
  return [...out];
}

/**
 * Whether same-origin enforcement is active for app API mutations (default ON).
 * Set CSRF_ENFORCE=false/0/off/no to disable.
 */
export function csrfEnforceSameOrigin(): boolean {
  const raw = (process.env.CSRF_ENFORCE ?? "").trim().toLowerCase();
  return !CSRF_ENFORCE_DISABLED_VALUES.has(raw);
}

// ---------------------------------------------------------------------------
// Security — event monitoring & alerting (RW-029)
// ---------------------------------------------------------------------------

/**
 * Number of times the same security event within the rolling window before it
 * is treated as a SPIKE (SECURITY_EVENT_ALERT_THRESHOLD, default 10).
 */
export function securityEventAlertThreshold(): number {
  return positiveIntEnv("SECURITY_EVENT_ALERT_THRESHOLD", 10);
}

/** Rolling window (ms) over which security-event spikes are counted (default 60000). */
export function securityEventWindowMs(): number {
  return positiveIntEnv("SECURITY_EVENT_WINDOW_MS", 60_000);
}

/**
 * Capacity of the in-memory recent-security-event ring buffer (default 200, max 2000).
 */
export function securityEventBufferSize(): number {
  const v = positiveIntEnv("SECURITY_EVENT_BUFFER_SIZE", 200);
  return Math.min(v, SECURITY_EVENT_BUFFER_SIZE_MAX);
}

// ---------------------------------------------------------------------------
// Audit log retention (#712-B)
// ---------------------------------------------------------------------------

/**
 * Retention window (in days) for pruneOldAuditLogs. Defaults to 730 days
 * (2 years), which covers common regulatory compliance windows. Operators with
 * shorter or longer requirements can override via AUDIT_LOG_RETENTION_DAYS.
 *
 * Set via AUDIT_LOG_RETENTION_DAYS. Use a value ≥ 90 to satisfy most
 * regulatory frameworks (PCI-DSS, SOC 2, GDPR recitals on legitimate interest).
 */
export function auditLogRetentionDays(): number {
  return positiveIntEnv("AUDIT_LOG_RETENTION_DAYS", 730);
}
