"use client";

import { useEffect } from "react";
import { Bookmark } from "lucide-react";
import { reportClientError } from "@/lib/client-error-reporter";
import ErrorScreen from "@/components/ErrorScreen";

/** Error boundary for the saved articles / lists page. */
export default function ListsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError({
      message: error.message || "Lists page render error",
      source: "lists-error",
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <ErrorScreen
      icon={Bookmark}
      title="Could not load your saved articles"
      description="Something went wrong while loading your saved articles. Try again or browse for new content."
      digest={error.digest}
      reset={reset}
      secondaryAction={{ label: "Browse articles", href: "/browse" }}
    />
  );
}
