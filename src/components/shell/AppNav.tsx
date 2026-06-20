"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Shield } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import { PRIMARY_NAV, isActivePath } from "./nav-items";
import type { ShellUser } from "./types";

/** Desktop primary navigation (hidden below md — see MobileDrawer). */
export default function AppNav({ user }: { user?: ShellUser | null }) {
  const pathname = usePathname();
  const isAdmin = user?.role === "Admin";

  return (
    <nav
      aria-label="Primary"
      className="hidden md:flex items-center gap-[var(--space-6)]"
    >
      {PRIMARY_NAV.map(({ href, label, icon: Icon }) => {
        const active = isActivePath(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative inline-flex items-center gap-[var(--space-1)] h-14 -mb-px",
              "text-[length:var(--text-sm)] rounded-[var(--radius-sm)]",
              "border-b-2 border-transparent",
              "transition-colors [transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-standard)]",
              active
                ? "font-semibold text-primary-text border-b-[var(--teal)]"
                : "font-medium text-text-muted hover:text-text",
              focusRing,
            )}
          >
            <Icon size={16} aria-hidden />
            {label}
          </Link>
        );
      })}
      {isAdmin ? (
        <Link
          href="/admin"
          aria-current={isActivePath(pathname, "/admin") ? "page" : undefined}
          className={cn(
            "relative inline-flex items-center gap-[var(--space-1)] h-14 -mb-px",
            "text-[length:var(--text-sm)] rounded-[var(--radius-sm)]",
            "border-b-2 border-transparent",
            "transition-colors [transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-standard)]",
            isActivePath(pathname, "/admin")
              ? "font-semibold text-primary-text border-b-[var(--teal)]"
              : "font-medium text-text-muted hover:text-text",
            focusRing,
          )}
        >
          <Shield size={16} aria-hidden />
          Admin
        </Link>
      ) : null}
    </nav>
  );
}
