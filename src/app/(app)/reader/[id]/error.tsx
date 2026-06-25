"use client";

import { BookOpen } from "lucide-react";
import { SegmentError } from "@/components/route-states";

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
  return (
    <SegmentError
      error={error}
      reset={reset}
      source="reader-error"
      icon={BookOpen}
      title="Couldn't load this article"
      description="Something went wrong while loading the article. Try again or browse other content."
      secondaryAction={{ label: "Browse articles", href: "/browse" }}
    />
  );
}
