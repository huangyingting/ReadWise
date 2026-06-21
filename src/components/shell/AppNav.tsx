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

  // Icon-only on md+ (labels live in tooltips + sr-only text + the mobile
  // drawer). The 1280px header cap can't fit 9 labelled links alongside the
  // wordmark and right-hand action cluster, so the compact rail prevents the
  // overflow/collision that labelled links caused (#134). Labels remain
  // available via tooltips, sr-only text, and the mobile drawer.
  const linkClass = (active: boolean) =>
    cn(
      "relative inline-flex items-center justify-center gap-[var(--space-1)]",
      "h-14 -mb-px px-[var(--space-2)]",
      "text-[length:var(--text-sm)] rounded-[var(--radius-sm)]",
      "border-b-2 border-transparent",
      "transition-colors [transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-standard)]",
      active
        ? "font-semibold text-primary-text border-b-[var(--teal)]"
        : "font-medium text-text-muted hover:text-text",
      focusRing,
    );

  return (
    <nav
      aria-label="Primary"
      className="hidden md:flex items-center gap-[var(--space-1)] lg:gap-[var(--space-2)]"
    >
      {PRIMARY_NAV.map(({ href, label, icon: Icon }) => {
        const active = isActivePath(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            title={label}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            className={linkClass(active)}
          >
            <Icon size={18} aria-hidden />
            <span className="sr-only">{label}</span>
          </Link>
        );
      })}
      {isAdmin ? (
        <Link
          href="/admin"
          title="Admin"
          aria-label="Admin"
          aria-current={isActivePath(pathname, "/admin") ? "page" : undefined}
          className={linkClass(isActivePath(pathname, "/admin"))}
        >
          <Shield size={18} aria-hidden />
          <span className="sr-only">Admin</span>
        </Link>
      ) : null}
    </nav>
  );
}
