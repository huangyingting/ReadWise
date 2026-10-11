import { cva, type VariantProps } from "class-variance-authority";
import { cn, focusRing } from "@/lib/cn";

/**
 * Borderless navigation item classes for secondary navigation rendered as
 * links (section rails, in-page view tabs, settings index). Inactive items are
 * muted text with a soft hover wash; the active item is a tinted primary pill.
 *
 * Keyboard/focus: apply to native `<a>`/`Link` elements so Tab order and
 * Enter activation stay native; the shared `focusRing` is included.
 * Accessibility: set `aria-current="page"` (or `"location"`) on the active
 * item alongside `active: true`.
 *
 * @example
 * <Link href="/admin/jobs" aria-current="page" className={navItemVariants({ active: true })}>
 *   Jobs
 * </Link>
 */
export const navItemVariants = cva(
  cn(
    "inline-flex h-8 shrink-0 select-none items-center whitespace-nowrap",
    "rounded-[var(--radius-md)] px-[var(--space-3)]",
    "text-[length:var(--type-ui)] no-underline hover:no-underline",
    "transition-colors [transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-standard)]",
    focusRing,
  ),
  {
    variants: {
      active: {
        true: "bg-[color-mix(in_srgb,var(--primary)_9%,transparent)] font-semibold text-primary-text",
        false:
          "font-medium text-text-muted hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)] hover:text-text",
      },
    },
    defaultVariants: { active: false },
  },
);

export type NavItemVariantProps = VariantProps<typeof navItemVariants>;
