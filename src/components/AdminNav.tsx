"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonVariants } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

const SECTIONS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/articles", label: "Articles" },
  { href: "/admin/tags", label: "Tags" },
  { href: "/admin/members", label: "Members" },
  { href: "/admin/analytics", label: "Analytics" },
];

export default function AdminNav() {
  const pathname = usePathname();

  return (
    <nav
      className="flex flex-wrap gap-[var(--space-2)] mt-[var(--space-4)] pb-[var(--space-3)] border-b border-border"
      aria-label="Admin sections"
    >
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
                "inline-flex items-center justify-center whitespace-nowrap select-none",
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
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
