"use client";

import { useEffect } from "react";

/**
 * Global client-side error capture (US-029). Registers `window.onerror` and
 * `unhandledrejection` listeners once and reports any uncaught runtime error or
 * rejected promise to `POST /api/client-errors`, where it is written to the
 * structured server logs. Reports are best-effort: failures to report are
 * swallowed, and a small in-memory throttle stops error storms from flooding
 * the network. Renders nothing.
 */
export default function ClientErrorReporter() {
  useEffect(() => {
    const seen = new Set<string>();
    let count = 0;
    const MAX_REPORTS = 20;

    const report = (message: string, source: string, stack?: string) => {
      if (count >= MAX_REPORTS) return;
      const key = `${source}:${message}:${stack ?? ""}`.slice(0, 500);
      if (seen.has(key)) return;
      seen.add(key);
      count += 1;
      try {
        const payload = JSON.stringify({
          message: message.slice(0, 2000),
          source,
          stack: stack?.slice(0, 8000),
          // Only origin + pathname — no query string or hash (privacy).
          url: window.location.origin + window.location.pathname,
        });
        const sent =
          typeof navigator.sendBeacon === "function" &&
          navigator.sendBeacon(
            "/api/client-errors",
            new Blob([payload], { type: "application/json" }),
          );
        if (!sent) {
          void fetch("/api/client-errors", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            keepalive: true,
          }).catch(() => {});
        }
      } catch {
        // Never let the reporter itself throw.
      }
    };

    const onError = (event: ErrorEvent) => {
      const message =
        event.message ||
        (event.error instanceof Error ? event.error.message : "Unknown error");
      const stack = event.error instanceof Error ? event.error.stack : undefined;
      report(message, "window.onerror", stack);
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : "Unhandled promise rejection";
      const stack = reason instanceof Error ? reason.stack : undefined;
      report(message, "unhandledrejection", stack);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
