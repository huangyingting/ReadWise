"use client";

/**
 * Centralized client-side error reporting helper (REF-015).
 *
 * All client error reports funnel through `reportClientError`. It owns:
 * - URL privacy (origin + pathname only — no query string or hash)
 * - Payload shape and field truncation
 * - `sendBeacon` preference with `keepalive fetch` fallback
 *   (raw-fetch exception: not routed through client-fetch to avoid recursive
 *   error reporting — same pattern established in ClientErrorReporter.tsx)
 * - Module-level dedupe/throttle (20 reports per page session)
 * - Never-throw guarantee
 */

export interface ClientErrorInput {
  message: string;
  source: string;
  digest?: string;
  stack?: string;
}

// Module-level throttle: shared across all callers per page load.
let _count = 0;
const _seen = new Set<string>();
const MAX_REPORTS = 20;

export function reportClientError({
  message,
  source,
  digest,
  stack,
}: ClientErrorInput): void {
  if (_count >= MAX_REPORTS) return;
  const key = `${source}:${message}:${stack ?? ""}`.slice(0, 500);
  if (_seen.has(key)) return;
  _seen.add(key);
  _count += 1;

  try {
    // Only origin + pathname — no query string or hash (privacy).
    const url =
      typeof window !== "undefined"
        ? window.location.origin + window.location.pathname
        : undefined;

    const payload = JSON.stringify({
      message: message.slice(0, 2000),
      source,
      digest,
      stack: stack?.slice(0, 8000),
      url,
    });

    const sent =
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function" &&
      navigator.sendBeacon(
        "/api/client-errors",
        new Blob([payload], { type: "application/json" }),
      );

    if (!sent) {
      // sendBeacon unavailable or returned false — fall back to keepalive fetch.
      void fetch("/api/client-errors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // The reporter must never throw.
  }
}

/** Visible for testing only — resets module-level state between tests. */
export function _resetReporter(): void {
  _count = 0;
  _seen.clear();
}
