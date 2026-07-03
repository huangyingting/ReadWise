"use client";

import { BookMarked } from "lucide-react";
import { SegmentError } from "@/components/route-states";

type StudyErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

const DASHBOARD_ACTION = { label: "Back to dashboard", href: "/dashboard" };

/** Error boundary for the study / saved-words page. */
export default function StudyError({
  error,
  reset,
}: StudyErrorProps) {
  return (
    <SegmentError
      error={error}
      reset={reset}
      source="study-error"
      icon={BookMarked}
      title="Could not load your study list"
      description="Something went wrong while loading your saved words. Try again or return to the dashboard."
      secondaryAction={DASHBOARD_ACTION}
    />
  );
}
