/**
 * Shared not-found renderer for Next.js route-segment `not-found.tsx` files (REF-063).
 *
 * Each route's `not-found.tsx` becomes a thin wrapper that passes its own icon,
 * title, description, and back-link configuration. Wraps `EmptyState` in the
 * standard centered-page layout.
 */

import type { LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/ui";

export interface SegmentNotFoundProps {
  /** Lucide icon rendered in the chip. */
  icon: LucideIcon;
  /** Primary heading text. */
  title: string;
  /** Supporting description. */
  description: string;
  /** Label for the back-navigation link. */
  backLabel?: string;
  /** href for the back-navigation link. */
  backHref?: string;
}

export function SegmentNotFound({
  icon,
  title,
  description,
  backLabel = "← Back to dashboard",
  backHref = "/dashboard",
}: SegmentNotFoundProps) {
  return (
    <main className="flex items-center justify-center min-h-[60vh] px-[var(--space-6)]">
      <EmptyState
        icon={icon}
        title={title}
        description={description}
        action={{ label: backLabel, href: backHref }}
      />
    </main>
  );
}
