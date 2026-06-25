"use client";

import { StickyNote } from "lucide-react";
import { SegmentError } from "@/components/route-states";

/** Error boundary for the notes & highlights page. */
export default function NotesError({
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
      source="notes-error"
      icon={StickyNote}
      title="Could not load your notes"
      description="Something went wrong while loading your notes and highlights. Try again or browse articles."
      secondaryAction={{ label: "Back to dashboard", href: "/dashboard" }}
    />
  );
}
