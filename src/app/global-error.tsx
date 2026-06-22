"use client";

import { useEffect } from "react";
import "./globals.css";

/**
 * Root error boundary (US-029). Catches React render/runtime errors that escape
 * page-level boundaries, reports them to the structured server logs via
 * `POST /api/client-errors`, and shows a minimal recovery UI. `global-error`
 * replaces the root layout, so it must render its own <html>/<body> and stay
 * self-contained — it imports `globals.css` directly so design tokens resolve.
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
        digest: error.digest,
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
        <main
          style={{
            minHeight: "100dvh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            gap: "var(--space-5)",
            padding: "var(--space-6)",
            background: "var(--bg)",
            color: "var(--text)",
          }}
        >
          {/* Self-contained brand wordmark (no Link/component deps). */}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-2)",
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 16 16"
              fill="none"
              stroke="var(--primary)"
              strokeWidth="1.6"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M8 1.5 14.5 8 8 14.5 1.5 8 8 1.5Z" />
              <path d="M8 4.5v7" />
            </svg>
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: "var(--text-xl)",
                color: "var(--text)",
              }}
            >
              ReadWise
            </span>
          </span>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
              maxWidth: "40ch",
            }}
          >
            <h1
              style={{
                margin: 0,
                fontFamily: "var(--font-display)",
                fontWeight: 600,
                fontSize: "var(--text-2xl)",
                color: "var(--text)",
              }}
            >
              Something went wrong
            </h1>
            <p
              style={{
                margin: 0,
                fontSize: "var(--text-base)",
                color: "var(--text-muted)",
              }}
            >
              An unexpected error occurred and has been reported. You can reload
              the page or head back to your dashboard.
            </p>
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: "var(--space-3)",
            }}
          >
            <button
              type="button"
              onClick={() => reset()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-2)",
                padding: "var(--space-3) var(--space-5)",
                borderRadius: "var(--radius-md)",
                border: 0,
                background: "var(--primary)",
                color: "var(--on-primary)",
                fontFamily: "var(--font-sans)",
                fontWeight: 600,
                fontSize: "var(--text-sm)",
                cursor: "pointer",
              }}
            >
              Reload
            </button>
            <a
              href="/dashboard"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-2)",
                padding: "var(--space-3) var(--space-5)",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border)",
                background: "var(--surface)",
                color: "var(--text)",
                fontFamily: "var(--font-sans)",
                fontWeight: 600,
                fontSize: "var(--text-sm)",
                textDecoration: "none",
              }}
            >
              ← Back to dashboard
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
