"use client";

import { useEffect } from "react";
import { TrendingUp } from "lucide-react";
import { reportClientError } from "@/lib/client-error-reporter";
import ErrorScreen from "@/components/ErrorScreen";

/** Error boundary for the progress / learner analytics page. */
export default function ProgressError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError({
      message: error.message || "Progress page render error",
      source: "progress-error",
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <ErrorScreen
      icon={TrendingUp}
      title="Could not load your progress"
      description="Something went wrong while loading your learning analytics. Try again or return to the dashboard."
      digest={error.digest}
      reset={reset}
      secondaryAction={{ label: "Back to dashboard", href: "/dashboard" }}
    />
  );
}
