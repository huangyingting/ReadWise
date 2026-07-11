"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/client-error-reporter";
import { Wordmark } from "@/components/Wordmark";
import { Button, buttonVariants } from "@/components/ui";
import "./globals.css";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

const GLOBAL_ERROR_SOURCE = "global-error";

function reportGlobalError(error: GlobalErrorProps["error"]) {
  reportClientError({
    message: error.message || "React render error",
    source: GLOBAL_ERROR_SOURCE,
    digest: error.digest,
    stack: error.stack,
  });
}

function RecoveryActions({ reset }: Pick<GlobalErrorProps, "reset">) {
  return (
    <div className="flex flex-wrap justify-center gap-[var(--space-3)]">
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
  );
}

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
}: GlobalErrorProps) {
  useEffect(() => {
    reportGlobalError(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main
          className="flex min-h-[100dvh] flex-col items-center justify-center gap-[var(--space-5)] bg-bg p-[var(--space-6)] text-center text-text"
        >
          <Wordmark size="error" />

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

          <RecoveryActions reset={reset} />
        </main>
      </body>
    </html>
  );
}
