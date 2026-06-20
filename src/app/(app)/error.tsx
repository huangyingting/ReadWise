"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Segment-level error boundary for the authenticated (app) route group.
 * Catches React render errors that escape page-level boundaries, reports them
 * to the structured server logs, and shows a friendly recovery UI.
 * Complements the root global-error.tsx (which owns the shell replacement case).
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    try {
      const payload = JSON.stringify({
        message: error.message || "App render error",
        source: "app-error",
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
    <div className="container flex flex-col items-center text-center gap-[var(--space-5)] py-[var(--space-12)]">
      <div
        className="inline-flex items-center justify-center h-14 w-14 rounded-[var(--radius-full)] bg-surface border border-border text-warning"
        aria-hidden
      >
        <AlertTriangle size={28} />
      </div>

      <div className="flex flex-col gap-[var(--space-2)]">
        <h1 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text m-0">
          Something went wrong
        </h1>
        <p className="text-text-muted text-[length:var(--text-base)] max-w-[40ch] m-0">
          An unexpected error occurred. You can try again or return to the
          dashboard.
        </p>
      </div>

      <div className="flex gap-[var(--space-3)] flex-wrap justify-center">
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex items-center gap-[var(--space-2)] px-[var(--space-5)] py-[var(--space-3)] rounded-[var(--radius-md)] bg-primary text-on-primary font-semibold text-[length:var(--text-sm)] border-0 cursor-pointer transition-colors hover:bg-primary-hover"
        >
          Try again
        </button>
        <a
          href="/dashboard"
          className="inline-flex items-center gap-[var(--space-2)] px-[var(--space-5)] py-[var(--space-3)] rounded-[var(--radius-md)] bg-surface text-text font-semibold text-[length:var(--text-sm)] border border-border cursor-pointer transition-colors hover:bg-bg-subtle no-underline"
        >
          Back to dashboard
        </a>
      </div>
    </div>
  );
}
