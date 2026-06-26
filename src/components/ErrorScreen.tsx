"use client";

/**
 * Shared error-screen UI primitive (REF-015).
 *
 * Used by Next.js route-level `error.tsx` files to render consistent error
 * recovery UI without duplicating markup. Each page passes its own icon, copy,
 * and action links; reporting is handled separately via `reportClientError`.
 */

import type { LucideIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/Button";

export interface ErrorScreenAction {
  label: string;
  href: string;
}

export interface ErrorScreenProps {
  /** Lucide icon rendered in the icon chip. */
  icon: LucideIcon;
  /** Primary heading text. */
  title: string;
  /** Supporting description shown below the heading. */
  description: string;
  /** Optional Next.js error digest shown as a compact mono ref. */
  digest?: string;
  /** When provided, renders a "Try again" primary button that calls this. */
  reset?: () => void;
  /** Label for the reset button. Defaults to "Try again". */
  resetLabel?: string;
  /** Optional secondary navigation link (e.g. "Back to dashboard"). */
  secondaryAction?: ErrorScreenAction;
  /** Outer wrapper className. Defaults to the container-centred layout. */
  className?: string;
  /** Outer wrapper inline style (e.g. for admin's extra top margin). */
  style?: React.CSSProperties;
  /** Heading element level. Defaults to "h1". */
  headingAs?: "h1" | "h2";
  /** Heading CSS class. Defaults to the standard display heading style. */
  titleClassName?: string;
}

export default function ErrorScreen({
  icon: Icon,
  title,
  description,
  digest,
  reset,
  resetLabel = "Try again",
  secondaryAction,
  className = "container flex flex-col items-center text-center gap-[var(--space-5)] py-[var(--space-12)]",
  style,
  headingAs: Heading = "h1",
  titleClassName = "font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-2xl)] text-text m-0",
}: ErrorScreenProps) {
  return (
    <div className={className} style={style}>
      <div
        className="inline-flex items-center justify-center h-14 w-14 rounded-[var(--radius-full)] bg-surface border border-border text-warning"
        aria-hidden
      >
        <Icon size={28} />
      </div>

      <div className="flex flex-col gap-[var(--space-2)]">
        <Heading className={titleClassName}>
          {title}
        </Heading>
        <p className="text-text-muted text-[length:var(--text-base)] max-w-[40ch] m-0">
          {description}
        </p>
        {digest ? (
          <p className="text-text-subtle text-[length:var(--text-xs)] font-mono m-0 mt-[var(--space-1)]">
            Error ref: {digest}
          </p>
        ) : null}
      </div>

      {(reset || secondaryAction) && (
        <div className="flex gap-[var(--space-3)] flex-wrap justify-center">
          {reset && (
            <Button type="button" onClick={() => reset()}>
              {resetLabel}
            </Button>
          )}
          {secondaryAction && (
            <a
              href={secondaryAction.href}
              className={buttonVariants({ variant: "outline" })}
            >
              {secondaryAction.label}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
