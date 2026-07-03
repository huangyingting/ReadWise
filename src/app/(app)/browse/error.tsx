"use client";

import { BookOpen } from "lucide-react";
import { SegmentError } from "@/components/route-states";
import type { SegmentErrorProps } from "@/components/route-states";

type BrowseErrorProps = Pick<SegmentErrorProps, "error" | "reset">;

const BROWSE_ERROR_CONFIG = {
  source: "browse-error",
  icon: BookOpen,
  title: "Could not load articles",
  description:
    "Something went wrong while loading the article feed. Try again or return to the dashboard.",
  secondaryAction: { label: "Back to dashboard", href: "/dashboard" },
} satisfies Omit<SegmentErrorProps, "error" | "reset">;

/** Error boundary for the browse / category-browsing page. */
export default function BrowseError({ error, reset }: BrowseErrorProps) {
  return (
    <SegmentError
      error={error}
      reset={reset}
      {...BROWSE_ERROR_CONFIG}
    />
  );
}
