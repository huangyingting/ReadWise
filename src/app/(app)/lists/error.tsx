"use client";

import { Bookmark } from "lucide-react";
import { SegmentError } from "@/components/route-states";
import type { SegmentErrorProps } from "@/components/route-states";

type ListsErrorProps = Pick<SegmentErrorProps, "error" | "reset">;

const LISTS_ERROR_CONFIG = {
  source: "lists-error",
  icon: Bookmark,
  title: "Could not load your saved articles",
  description:
    "Something went wrong while loading your saved articles. Try again or browse for new content.",
  secondaryAction: { label: "Browse articles", href: "/browse" },
} satisfies Omit<SegmentErrorProps, "error" | "reset">;

/** Error boundary for the saved articles / lists page. */
export default function ListsError({ error, reset }: ListsErrorProps) {
  return (
    <SegmentError
      error={error}
      reset={reset}
      {...LISTS_ERROR_CONFIG}
    />
  );
}
