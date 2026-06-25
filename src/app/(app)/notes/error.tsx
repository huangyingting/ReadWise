"use client";

import { useEffect } from "react";
import { StickyNote } from "lucide-react";
import { reportClientError } from "@/lib/client-error-reporter";
import ErrorScreen from "@/components/ErrorScreen";

/** Error boundary for the notes & highlights page. */
export default function NotesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError({
      message: error.message || "Notes page render error",
      source: "notes-error",
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <ErrorScreen
      icon={StickyNote}
      title="Could not load your notes"
      description="Something went wrong while loading your notes and highlights. Try again or browse articles."
      digest={error.digest}
      reset={reset}
      secondaryAction={{ label: "Back to dashboard", href: "/dashboard" }}
    />
  );
}
