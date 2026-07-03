"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/client-error-reporter";

function getErrorDetails(
  value: unknown,
  fallbackMessage: string,
  useStringValue = false,
) {
  if (value instanceof Error) {
    return { message: value.message, stack: value.stack };
  }

  if (useStringValue && typeof value === "string") {
    return { message: value, stack: undefined };
  }

  return { message: fallbackMessage, stack: undefined };
}

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
      const { message, stack } = event.message
        ? {
            message: event.message,
            stack: event.error instanceof Error ? event.error.stack : undefined,
          }
        : getErrorDetails(event.error, "Unknown error");
      reportClientError({ message, source: "window.onerror", stack });
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const { message, stack } = getErrorDetails(
        event.reason,
        "Unhandled promise rejection",
        true,
      );
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
