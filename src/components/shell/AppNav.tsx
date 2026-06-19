"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn, focusRing } from "@/lib/cn";
import { PRIMARY_NAV, isActivePath } from "./nav-items";

/** Desktop primary navigation (hidden below md — see MobileDrawer). */
export default function AppNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="hidden md:flex items-center gap-[var(--space-6)]"
    >
      {PRIMARY_NAV.map(({ href, label }) => {
        const active = isActivePath(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative inline-flex items-center h-14 -mb-px",
              "text-[length:var(--text-sm)] rounded-[var(--radius-sm)]",
              "border-b-2 border-transparent",
              "transition-colors [transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-standard)]",
              active
                ? "font-semibold text-primary-text border-b-[var(--teal)]"
                : "font-medium text-text-muted hover:text-text",
              focusRing,
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
