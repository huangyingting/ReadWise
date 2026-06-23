import Link from "next/link";
import { buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

const TABS = [
  { key: "product", href: "/admin/analytics", label: "Product" },
  { key: "ai", href: "/admin/analytics/ai", label: "AI & content ops" },
] as const;

/**
 * In-page sub-navigation for the analytics area, switching between the product
 * (funnel/retention) dashboards and the AI cost / content-ops dashboards.
 * Rendered server-side; the active tab is supplied by the page.
 */
export function AnalyticsTabs({ active }: { active: "product" | "ai" }) {
  return (
    <nav className="flex flex-wrap gap-[var(--space-2)]" aria-label="Analytics views">
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={
              isActive
                ? cn(
                    "inline-flex items-center justify-center whitespace-nowrap select-none shrink-0",
                    "border border-primary text-primary-text",
                    "bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]",
                    "rounded-[var(--radius-md)] px-[var(--space-3)] h-8",
                    "font-semibold text-[length:var(--text-sm)]",
                  )
                : cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
