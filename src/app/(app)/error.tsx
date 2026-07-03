"use client";

import { AlertTriangle } from "lucide-react";
import { SegmentError } from "@/components/route-states";
import type { SegmentErrorProps } from "@/components/route-states";

type AppErrorProps = Pick<SegmentErrorProps, "error" | "reset">;

const APP_ERROR_CONFIG = {
  source: "app-error",
  icon: AlertTriangle,
  title: "Something went wrong",
  description: "An unexpected error occurred. You can try again or return to the dashboard.",
  secondaryAction: { label: "Back to dashboard", href: "/dashboard" },
} satisfies Omit<SegmentErrorProps, "error" | "reset">;

/**
 * Segment-level error boundary for the authenticated (app) route group.
 * Catches React render errors that escape page-level boundaries, reports them
 * to the structured server logs, and shows a friendly recovery UI.
 * Complements the root global-error.tsx (which owns the shell replacement case).
 */
export default function AppError({
  error,
  reset,
}: AppErrorProps) {
  return (
    <SegmentError
      error={error}
      reset={reset}
      {...APP_ERROR_CONFIG}
    />
  );
}
