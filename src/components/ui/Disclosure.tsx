import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";

export interface DisclosureProps
  extends Omit<React.DetailsHTMLAttributes<HTMLDetailsElement>, "title"> {
  /** Always-visible summary label. */
  title: React.ReactNode;
  /** Optional muted hint rendered next to the title. */
  description?: React.ReactNode;
  /** Start expanded (uncontrolled). */
  defaultOpen?: boolean;
}

/**
 * Collapsible, borderless panel for secondary tools that should not push the
 * page's primary content down (bulk operations, advanced filters, rarely used
 * forms). Built on native `<details>`/`<summary>`, so it works without JS.
 *
 * Keyboard: the summary is natively focusable; Enter/Space toggle it.
 * Focus: the summary uses the shared `focusRing`.
 * Accessibility: browsers expose the summary's expanded state natively; keep
 * the title short and descriptive.
 *
 * @example
 * <Disclosure title="Backfill & rebuild" description="Enqueue capped jobs">
 *   <AdminBackfillForm />
 * </Disclosure>
 */
export function Disclosure({
  title,
  description,
  defaultOpen,
  className,
  children,
  ...props
}: DisclosureProps): React.ReactElement {
  return (
    <details
      open={defaultOpen}
      className={cn(
        "group w-full rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-surface)]",
        className,
      )}
      {...props}
    >
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-[var(--space-2)] rounded-[var(--radius-lg)]",
          "px-[var(--space-4)] py-[var(--space-3)] [&::-webkit-details-marker]:hidden",
          "hover:bg-[color-mix(in_srgb,var(--text)_3%,transparent)]",
          focusRing,
        )}
      >
        <ChevronRight
          size={16}
          aria-hidden
          className="shrink-0 text-text-subtle transition-transform [transition-duration:var(--duration-fast)] group-open:rotate-90"
        />
        <span className="font-[family-name:var(--font-display)] text-[length:var(--type-section-title-compact)] font-semibold text-text">
          {title}
        </span>
        {description ? (
          <span className="min-w-0 truncate text-[length:var(--type-ui)] text-text-subtle">
            {description}
          </span>
        ) : null}
      </summary>
      <div className="px-[var(--space-4)] pb-[var(--space-4)] pt-[var(--space-1)]">
        {children}
      </div>
    </details>
  );
}
