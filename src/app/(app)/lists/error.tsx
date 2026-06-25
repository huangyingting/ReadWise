"use client";

import { Bookmark } from "lucide-react";
import { SegmentError } from "@/components/route-states";

/** Error boundary for the saved articles / lists page. */
export default function ListsError({
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
      source="lists-error"
      icon={Bookmark}
      title="Could not load your saved articles"
      description="Something went wrong while loading your saved articles. Try again or browse for new content."
      secondaryAction={{ label: "Browse articles", href: "/browse" }}
    />
  );
}
