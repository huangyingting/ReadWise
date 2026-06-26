import Link from "next/link";
import { adminNavLinkVariants } from "./adminNavLinkVariants";

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
            className={adminNavLinkVariants(isActive, "outline")}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
