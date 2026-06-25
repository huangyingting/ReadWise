"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/client-error-reporter";

/**
 * Global client-side error capture (US-029). Registers `window.onerror` and
 * `unhandledrejection` listeners once and reports any uncaught runtime error or
 * rejected promise to `POST /api/client-errors` via the shared
 * `reportClientError` helper. Reports are best-effort: failures are swallowed,
 * and the helper's module-level throttle stops error storms. Renders nothing.
 */
export default function ClientErrorReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const message =
        event.message ||
        (event.error instanceof Error ? event.error.message : "Unknown error");
      const stack = event.error instanceof Error ? event.error.stack : undefined;
      reportClientError({ message, source: "window.onerror", stack });
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
      reportClientError({ message, source: "unhandledrejection", stack });
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
