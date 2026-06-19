import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** Optional CTA rendered as an M1 primary Button-styled Link. */
  action?: { label: string; href: string };
  className?: string;
}

/**
 * Branded empty state. Replaces every plain "No articles…" paragraph in
 * listings. When placed directly inside a CSS grid, `col-span-full` stretches
 * it across all columns.
 */
export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "col-span-full",
        "flex flex-col items-center text-center",
        "gap-[var(--space-3)]",
        "py-[var(--space-10)] px-[var(--space-6)]",
        "rounded-[var(--radius-lg)]",
        "border border-dashed border-border",
        "bg-bg-subtle",
        className,
      )}
    >
      {/* Icon chip */}
      <div
        className="inline-flex items-center justify-center h-12 w-12 rounded-[var(--radius-full)] bg-surface border border-border text-text-subtle"
        aria-hidden
      >
        <Icon size={24} />
      </div>

      <p className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-lg)] text-text m-0">
        {title}
      </p>

      {description ? (
        <p className="text-text-muted text-[length:var(--text-sm)] max-w-[40ch] m-0">
          {description}
        </p>
      ) : null}

      {action ? (
        <Link
          href={action.href}
          className={buttonVariants({ variant: "primary", size: "sm" })}
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
