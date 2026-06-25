"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { reportClientError } from "@/lib/client-error-reporter";
import ErrorScreen from "@/components/ErrorScreen";

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
    reportClientError({
      message: error.message || "App render error",
      source: "app-error",
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <ErrorScreen
      icon={AlertTriangle}
      title="Something went wrong"
      description="An unexpected error occurred. You can try again or return to the dashboard."
      reset={reset}
      secondaryAction={{ label: "Back to dashboard", href: "/dashboard" }}
    />
  );
}
