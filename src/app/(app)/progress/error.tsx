"use client";

import { TrendingUp } from "lucide-react";
import { SegmentError } from "@/components/route-states";

const PROGRESS_ERROR_ACTION = { label: "Back to dashboard", href: "/dashboard" } as const;

/** Error boundary for the progress / learner analytics page. */
export default function ProgressError({
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
      source="progress-error"
      icon={TrendingUp}
      title="Could not load your progress"
      description="Something went wrong while loading your learning analytics. Try again or return to the dashboard."
      secondaryAction={PROGRESS_ERROR_ACTION}
    />
  );
}
