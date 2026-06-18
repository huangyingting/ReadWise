"use client";

import { useEffect } from "react";

/**
 * Root error boundary (US-029). Catches React render/runtime errors that escape
 * page-level boundaries, reports them to the structured server logs via
 * `POST /api/client-errors`, and shows a minimal recovery UI. `global-error`
 * replaces the root layout, so it must render its own <html>/<body>.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    try {
      const payload = JSON.stringify({
        message: error.message || "React render error",
        source: "global-error",
        stack: error.stack,
        url: typeof window !== "undefined" ? window.location.href : undefined,
        userAgent:
          typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      });
      void fetch("/api/client-errors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Reporting must never throw.
    }
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main style={{ maxWidth: 560, margin: "4rem auto", padding: "0 1rem" }}>
          <h1>Something went wrong</h1>
          <p>
            An unexpected error occurred and has been reported. You can try
            again.
          </p>
          <button type="button" onClick={() => reset()}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
