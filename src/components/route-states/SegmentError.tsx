"use client";

/**
 * Shared error-boundary renderer for Next.js route-segment `error.tsx` files (REF-063).
 *
 * Encapsulates:
 *  - `useEffect` → `reportClientError` (REF-015) so individual segments don't
 *    duplicate the POST logic.
 *  - `ErrorScreen` rendering with per-segment copy configuration.
 *
 * Each route's `error.tsx` becomes a thin wrapper that passes its own icon,
 * title, description, source tag, and optional secondary action.
 */

import { useEffect } from "react";
import type { LucideIcon } from "lucide-react";
import { reportClientError } from "@/lib/client-error-reporter";
import ErrorScreen from "@/components/ErrorScreen";
import type { ErrorScreenAction } from "@/components/ErrorScreen";
import type { ErrorScreenProps } from "@/components/ErrorScreen";

export interface SegmentErrorProps {
  /** Next.js-injected error object from the error boundary. */
  error: Error & { digest?: string };
  /** Next.js-injected reset callback. */
  reset: () => void;
  /** Identifier sent with the error report (e.g. "browse-error"). */
  source: string;
  /** Lucide icon for the error screen chip. */
  icon: LucideIcon;
  /** Primary heading text. */
  title: string;
  /** Supporting description. */
  description: string;
  /** Optional secondary navigation link. */
  secondaryAction?: ErrorScreenAction;
  /** Pass-through to ErrorScreen for admin/reader compact variants. */
  headingAs?: ErrorScreenProps["headingAs"];
  /** Pass-through to ErrorScreen for admin compact heading style. */
  titleClassName?: ErrorScreenProps["titleClassName"];
  /** Pass-through to ErrorScreen for admin outer wrapper class. */
  className?: ErrorScreenProps["className"];
  /** Pass-through to ErrorScreen for admin extra top margin. */
  style?: React.CSSProperties;
}

export function SegmentError({
  error,
  reset,
  source,
  icon,
  title,
  description,
  secondaryAction,
  headingAs,
  titleClassName,
  className,
  style,
}: SegmentErrorProps) {
  useEffect(() => {
    reportClientError({
      message: error.message || `${source} render error`,
      source,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error, source]);

  return (
    <ErrorScreen
      icon={icon}
      title={title}
      description={description}
      digest={error.digest}
      reset={reset}
      secondaryAction={secondaryAction}
      headingAs={headingAs}
      titleClassName={titleClassName}
      className={className}
      style={style}
    />
  );
}
