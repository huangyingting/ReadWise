"use client";

import { TagIcon } from "lucide-react";
import { SegmentError } from "@/components/route-states";

type TagErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

const DASHBOARD_ACTION = { label: "Back to dashboard", href: "/dashboard" };

/** Error boundary for the tag-browsing page. */
export default function TagError({
  error,
  reset,
}: TagErrorProps) {
  return (
    <SegmentError
      error={error}
      reset={reset}
      source="tag-error"
      icon={TagIcon}
      title="Could not load this tag"
      description="Something went wrong while loading articles for this tag. Try again or return to the dashboard."
      secondaryAction={DASHBOARD_ACTION}
    />
  );
}
