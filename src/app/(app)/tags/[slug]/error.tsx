"use client";

import { TagIcon } from "lucide-react";
import { SegmentError } from "@/components/route-states";

/** Error boundary for the tag-browsing page. */
export default function TagError({
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
      source="tag-error"
      icon={TagIcon}
      title="Could not load this tag"
      description="Something went wrong while loading articles for this tag. Try again or return to the dashboard."
      secondaryAction={{ label: "Back to dashboard", href: "/dashboard" }}
    />
  );
}
