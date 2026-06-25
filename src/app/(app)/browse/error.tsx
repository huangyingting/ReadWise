"use client";

import { useEffect } from "react";
import { BookOpen } from "lucide-react";
import { reportClientError } from "@/lib/client-error-reporter";
import ErrorScreen from "@/components/ErrorScreen";

/** Error boundary for the browse / category-browsing page. */
export default function BrowseError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError({
      message: error.message || "Browse page render error",
      source: "browse-error",
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <ErrorScreen
      icon={BookOpen}
      title="Could not load articles"
      description="Something went wrong while loading the article feed. Try again or return to the dashboard."
      digest={error.digest}
      reset={reset}
      secondaryAction={{ label: "Back to dashboard", href: "/dashboard" }}
    />
  );
}
