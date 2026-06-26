/**
 * Shared active-tab class variant helper for admin navigation strips.
 *
 * Both `AnalyticsTabs` and `AdminNav` render a horizontal pill nav where the
 * active item uses a tinted primary border style and inactive items fall back
 * to a `Button`-derived `ghost` or `outline` appearance. This helper
 * centralises the duplicated class chain (DSGN2-12).
 */
import { cn } from "@/lib/cn";
import { buttonVariants } from "@/components/ui/Button";

type InactiveVariant = "ghost" | "outline";

/**
 * Returns the CSS class string for a nav link in an admin tab strip.
 *
 * @param isActive      Whether this link represents the current page/view.
 * @param inactiveVariant  Button variant for the inactive state. Default: "ghost".
 */
export function adminNavLinkVariants(
  isActive: boolean,
  inactiveVariant: InactiveVariant = "ghost",
): string {
  if (isActive) {
    return cn(
      "inline-flex items-center justify-center whitespace-nowrap select-none shrink-0",
      "border border-primary text-primary-text",
      "bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]",
      "rounded-[var(--radius-md)] px-[var(--space-3)] h-8",
      "font-semibold text-[length:var(--text-sm)]",
      "transition-[background-color,border-color] [transition-duration:var(--duration-fast)]",
    );
  }
  return cn(buttonVariants({ variant: inactiveVariant, size: "sm" }), "shrink-0");
}
