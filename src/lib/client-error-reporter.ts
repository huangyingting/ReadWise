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
const REPORT_ENDPOINT = "/api/client-errors";
const DEDUPE_KEY_MAX_LENGTH = 500;
const MESSAGE_MAX_LENGTH = 2000;
const STACK_MAX_LENGTH = 8000;

function markReportSeen({ message, source, stack }: ClientErrorInput): boolean {
  if (_count >= MAX_REPORTS) return false;

  const key = `${source}:${message}:${stack ?? ""}`.slice(0, DEDUPE_KEY_MAX_LENGTH);
  if (_seen.has(key)) return false;

  _seen.add(key);
  _count += 1;
  return true;
}

function currentPrivateSafeUrl(): string | undefined {
  return typeof window !== "undefined"
    ? window.location.origin + window.location.pathname
    : undefined;
}

function serializeClientError({ message, source, digest, stack }: ClientErrorInput): string {
  return JSON.stringify({
    message: message.slice(0, MESSAGE_MAX_LENGTH),
    source,
    digest,
    stack: stack?.slice(0, STACK_MAX_LENGTH),
    url: currentPrivateSafeUrl(),
  });
}

function sendWithBeacon(payload: string): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.sendBeacon === "function" &&
    navigator.sendBeacon(REPORT_ENDPOINT, new Blob([payload], { type: "application/json" }))
  );
}

function sendWithKeepaliveFetch(payload: string): void {
  // Raw fetch avoids recursive client error reporting.
  void fetch(REPORT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => {});
}

export function reportClientError({
  message,
  source,
  digest,
  stack,
}: ClientErrorInput): void {
  if (!markReportSeen({ message, source, digest, stack })) return;

  try {
    const payload = serializeClientError({ message, source, digest, stack });

    if (!sendWithBeacon(payload)) {
      // sendBeacon unavailable or returned false — fall back to keepalive fetch.
      sendWithKeepaliveFetch(payload);
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
