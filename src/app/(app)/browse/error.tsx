"use client";

import { BookOpen } from "lucide-react";
import { SegmentError } from "@/components/route-states";

/** Error boundary for the browse / category-browsing page. */
export default function BrowseError({
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
      source="browse-error"
      icon={BookOpen}
      title="Could not load articles"
      description="Something went wrong while loading the article feed. Try again or return to the dashboard."
      secondaryAction={{ label: "Back to dashboard", href: "/dashboard" }}
    />
  );
}
