"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/client-error-reporter";
import { Button, buttonVariants } from "@/components/ui";
import "./globals.css";

/**
 * Root error boundary (US-029). Catches React render/runtime errors that escape
 * page-level boundaries, reports them to the structured server logs via the
 * shared `reportClientError` helper, and shows a minimal recovery UI.
 * `global-error` replaces the root layout, so it must render its own
 * <html>/<body> and stay self-contained — it imports `globals.css` directly so
 * design tokens resolve.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError({
      message: error.message || "React render error",
      source: "global-error",
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main
          className="flex min-h-[100dvh] flex-col items-center justify-center gap-[var(--space-5)] bg-bg p-[var(--space-6)] text-center text-text"
        >
          {/* Self-contained brand wordmark (no Link/component deps). */}
          <span
            className="inline-flex items-center gap-[var(--space-2)]"
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
              className="font-[family-name:var(--font-display)] text-[length:var(--text-xl)] font-bold text-text"
            >
              ReadWise
            </span>
          </span>

          <div
            className="flex max-w-[40ch] flex-col gap-[var(--space-2)]"
          >
            <h1
              className="m-0 font-[family-name:var(--font-display)] text-[length:var(--text-2xl)] font-semibold text-text"
            >
              Something went wrong
            </h1>
            <p
              className="m-0 text-[length:var(--text-base)] text-text-muted"
            >
              An unexpected error occurred and has been reported. You can reload
              the page or head back to your dashboard.
            </p>
          </div>

          <div
            className="flex flex-wrap justify-center gap-[var(--space-3)]"
          >
            <Button
              type="button"
              onClick={() => reset()}
            >
              Reload
            </Button>
            <a
              href="/dashboard"
              className={buttonVariants({ variant: "secondary", size: "md" })}
            >
              ← Back to dashboard
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
