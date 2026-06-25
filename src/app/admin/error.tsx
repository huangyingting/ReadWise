"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { reportClientError } from "@/lib/client-error-reporter";
import ErrorScreen from "@/components/ErrorScreen";

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
    reportClientError({
      message: error.message || "Admin render error",
      source: "admin-error",
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <ErrorScreen
      icon={AlertTriangle}
      title="Something went wrong"
      description="An unexpected error occurred while loading this admin page."
      digest={error.digest}
      reset={reset}
      headingAs="h2"
      titleClassName="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text m-0"
      className="flex flex-col items-center text-center gap-[var(--space-5)] py-[var(--space-12)]"
      style={{ marginTop: "var(--space-6)" }}
    />
  );
}
