"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

const SECTIONS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/articles", label: "Articles" },
  { href: "/admin/sources", label: "Sources" },
  { href: "/admin/tags", label: "Tags" },
  { href: "/admin/members", label: "Members" },
  { href: "/admin/jobs", label: "Jobs" },
  { href: "/admin/analytics", label: "Analytics" },
  { href: "/admin/security", label: "Security" },
];

/**
 * Admin secondary sub-nav — a horizontal tab strip rendered inside the unified
 * shell, above the admin page content. Scrolls horizontally below the available
 * width (never clips items) and marks the active section with `aria-current`.
 */
export default function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="admin-subnav" aria-label="Admin sections">
      <div className="admin-subnav-track">
        {SECTIONS.map((section) => {
          const isActive =
            section.href === "/admin"
              ? pathname === "/admin"
              : pathname === section.href ||
                pathname.startsWith(`${section.href}/`);

          if (isActive) {
            return (
              <Link
                key={section.href}
                href={section.href}
                className={cn(
                  "inline-flex items-center justify-center whitespace-nowrap select-none shrink-0",
                  "border border-primary text-primary-text",
                  "bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]",
                  "rounded-[var(--radius-md)] px-[var(--space-3)] h-8",
                  "font-semibold text-[length:var(--text-sm)]",
                  "transition-[background-color,border-color] [transition-duration:var(--duration-fast)]",
                )}
                aria-current="page"
              >
                {section.label}
              </Link>
            );
          }

          return (
            <Link
              key={section.href}
              href={section.href}
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "shrink-0",
              )}
            >
              {section.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
