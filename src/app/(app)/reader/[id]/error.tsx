"use client";

import { useEffect } from "react";
import { BookOpen } from "lucide-react";
import { reportClientError } from "@/lib/client-error-reporter";
import ErrorScreen from "@/components/ErrorScreen";

/**
 * Reader-segment error boundary. Shown when the article page throws
 * (e.g. DB timeout, network error during streaming). Reports to the
 * structured server logs. The parent (app)/error.tsx is the fallback.
 */
export default function ReaderError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError({
      message: error.message || "Reader render error",
      source: "reader-error",
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <ErrorScreen
      icon={BookOpen}
      title="Couldn't load this article"
      description="Something went wrong while loading the article. Try again or browse other content."
      digest={error.digest}
      reset={reset}
      secondaryAction={{ label: "Browse articles", href: "/browse" }}
    />
  );
}
