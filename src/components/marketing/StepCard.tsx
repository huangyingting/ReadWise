import * as React from "react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";

export interface StepCardProps {
  step: string;
  icon: React.ReactNode;
  title: string;
  body: string;
  /** Suppress the desktop connector line after the final step. */
  isLast?: boolean;
  className?: string;
}

/**
 * A single "How It Works" step. On desktop the cards form a horizontal stepper
 * with a faint connector line between them (via an ::after pseudo on lg+); on
 * mobile they stack vertically.
 */
export function StepCard({
  step,
  icon,
  title,
  body,
  isLast = false,
  className,
}: StepCardProps) {
  return (
    <div
      className={cn(
        "relative flex flex-1 flex-col gap-[var(--space-3)]",
        !isLast &&
          "lg:after:absolute lg:after:left-full lg:after:top-5 lg:after:h-0.5 lg:after:w-[var(--space-6)] lg:after:bg-border lg:after:content-['']",
        className,
      )}
    >
      <div className="flex items-center gap-[var(--space-3)]">
        <Badge
          variant="primary"
          className="h-7 w-7 rounded-[var(--radius-full)] p-0 text-[length:var(--text-sm)]"
        >
          {step}
        </Badge>
        <span className="inline-flex text-primary-text" aria-hidden="true">
          {icon}
        </span>
      </div>

      <h3 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] leading-[var(--leading-snug)] text-text">
        {title}
      </h3>

      <p className="text-[length:var(--text-base)] leading-[var(--leading-normal)] text-text-muted">
        {body}
      </p>
    </div>
  );
}
