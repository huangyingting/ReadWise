import * as React from "react";
import { Check } from "lucide-react";
import { Card, CardTitle } from "@/components/ui";
import { cn } from "@/lib/cn";

export type FeatureAccent = "primary" | "teal";

export interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  body: string;
  features: string[];
  /** Left-border accent. Teal marks the narration / reading-state group. */
  accent?: FeatureAccent;
  className?: string;
}

/**
 * Marketing feature group — wraps the M1 Card with an airier radius/padding, a
 * hover elevation, a Lucide icon chip, and a 3px left-border accent.
 */
export function FeatureCard({
  icon,
  title,
  body,
  features,
  accent = "primary",
  className,
}: FeatureCardProps) {
  const accentVar = accent === "teal" ? "var(--teal)" : "var(--primary)";

  return (
    <Card
      className={cn(
        "flex h-full flex-col gap-[var(--space-4)] rounded-[var(--radius-xl)] p-[var(--space-7)] sm:p-[var(--space-7)]",
        "transition-shadow [transition-duration:var(--duration-base)] [transition-timing-function:var(--ease-standard)] hover:shadow-[var(--shadow-md)]",
        className,
      )}
      style={{ borderLeftWidth: "3px", borderLeftColor: accentVar }}
    >
      <span
        className="inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)]"
        style={{
          color: accentVar,
          background: `color-mix(in srgb, ${accentVar} 12%, transparent)`,
        }}
        aria-hidden="true"
      >
        {icon}
      </span>

      <CardTitle>{title}</CardTitle>

      <p className="text-[length:var(--text-base)] leading-[var(--leading-normal)] text-text-muted">
        {body}
      </p>

      <ul className="mt-auto flex flex-col gap-[var(--space-2)]">
        {features.map((feature) => (
          <li
            key={feature}
            className="flex items-start gap-[var(--space-2)] text-[length:var(--text-sm)] text-text"
          >
            <Check
              size={16}
              className="mt-0.5 shrink-0 text-primary-text"
              aria-hidden="true"
            />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
