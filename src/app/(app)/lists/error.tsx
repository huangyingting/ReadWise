"use client";

import { useEffect } from "react";
import { Bookmark } from "lucide-react";

/** Error boundary for the saved articles / lists page. */
export default function ListsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    try {
      void fetch("/api/client-errors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: error.message || "Lists page render error",
          source: "lists-error",
          digest: error.digest,
          stack: error.stack,
          url: typeof window !== "undefined" ? window.location.href : undefined,
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        }),
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
        <Bookmark size={28} />
      </div>

      <div className="flex flex-col gap-[var(--space-2)]">
        <h1 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text m-0">
          Could not load your saved articles
        </h1>
        <p className="text-text-muted text-[length:var(--text-base)] max-w-[40ch] m-0">
          Something went wrong while loading your saved articles. Try again or browse for new content.
        </p>
        {error.digest ? (
          <p className="text-text-subtle text-[length:var(--text-xs)] font-mono m-0 mt-[var(--space-1)]">
            Error ref: {error.digest}
          </p>
        ) : null}
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
          href="/browse"
          className="inline-flex items-center gap-[var(--space-2)] px-[var(--space-5)] py-[var(--space-3)] rounded-[var(--radius-md)] bg-surface text-text font-semibold text-[length:var(--text-sm)] border border-border cursor-pointer transition-colors hover:bg-bg-subtle no-underline"
        >
          Browse articles
        </a>
      </div>
    </div>
  );
}
