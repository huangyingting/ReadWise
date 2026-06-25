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

function optionalNonNegativeIntEnv(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return null;
  const v = parseInt(raw, 10);
  return Number.isInteger(v) && v >= 0 ? v : null;
}

/** Resolved trusted-proxy configuration (env-driven; all strategies optional). */
export function trustedProxyConfig(): TrustedProxyConfig {
  const listRaw = envValue("TRUSTED_PROXY_LIST");
  const list = listRaw
    ? listRaw
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : [];
  const headerRaw = envValue("TRUSTED_PROXY_HEADER");
  return {
    hops: optionalNonNegativeIntEnv("TRUSTED_PROXY_HOPS"),
    list,
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

/**
 * Extra origins (beyond the request's own host) allowed to make state-changing
 * API calls. NEXTAUTH_URL / APP_URL / NEXT_PUBLIC_APP_URL are always trusted.
 */
export function csrfAllowedOrigins(): string[] {
  const out = new Set<string>();
  const raw =
    envValue("CSRF_ALLOWED_ORIGINS") ?? envValue("CSRF_TRUSTED_ORIGINS");
  if (raw) {
    for (const entry of raw.split(",")) {
      const origin = normalizeOriginValue(entry);
      if (origin) out.add(origin);
    }
  }
  for (const name of ["NEXTAUTH_URL", "APP_URL", "NEXT_PUBLIC_APP_URL"]) {
    const origin = normalizeOriginValue(envValue(name));
    if (origin) out.add(origin);
  }
  return [...out];
}

/**
 * Whether same-origin enforcement is active for app API mutations (default ON).
 * Set CSRF_ENFORCE=false/0/off/no to disable.
 */
export function csrfEnforceSameOrigin(): boolean {
  const raw = (process.env.CSRF_ENFORCE ?? "").trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "off" || raw === "no") return false;
  return true;
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
  return Math.min(v, 2000);
}
