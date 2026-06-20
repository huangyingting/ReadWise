"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Admin-area segment error boundary. Shown when an admin page throws.
 * Reports to the structured server logs and provides a retry action.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    try {
      const payload = JSON.stringify({
        message: error.message || "Admin render error",
        source: "admin-error",
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
    <div
      className="flex flex-col items-center text-center gap-[var(--space-5)] py-[var(--space-12)]"
      style={{ marginTop: "var(--space-6)" }}
    >
      <div
        className="inline-flex items-center justify-center h-14 w-14 rounded-[var(--radius-full)] bg-surface border border-border text-warning"
        aria-hidden
      >
        <AlertTriangle size={28} />
      </div>

      <div className="flex flex-col gap-[var(--space-2)]">
        <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text m-0">
          Something went wrong
        </h2>
        <p className="text-text-muted text-[length:var(--text-base)] max-w-[40ch] m-0">
          An unexpected error occurred while loading this admin page.
        </p>
        {error.digest ? (
          <p className="text-text-subtle text-[length:var(--text-xs)] font-mono m-0 mt-[var(--space-1)]">
            Error ref: {error.digest}
          </p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => reset()}
        className="inline-flex items-center gap-[var(--space-2)] px-[var(--space-5)] py-[var(--space-3)] rounded-[var(--radius-md)] bg-primary text-on-primary font-semibold text-[length:var(--text-sm)] border-0 cursor-pointer transition-colors hover:bg-primary-hover"
      >
        Try again
      </button>
    </div>
  );
}
