"use client";

import { AlertTriangle } from "lucide-react";
import { SegmentError } from "@/components/route-states";

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
  return (
    <SegmentError
      error={error}
      reset={reset}
      source="admin-error"
      icon={AlertTriangle}
      title="Something went wrong"
      description="An unexpected error occurred while loading this admin page."
      headingAs="h2"
      titleClassName="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text m-0"
      className="flex flex-col items-center text-center gap-[var(--space-5)] py-[var(--space-12)]"
      style={{ marginTop: "var(--space-6)" }}
    />
  );
}
