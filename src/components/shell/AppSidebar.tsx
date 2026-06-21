"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Shield,
  PanelLeft,
  ChevronsLeft,
  type LucideIcon,
} from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import { PRIMARY_NAV, isActivePath } from "./nav-items";
import type { ShellUser } from "./types";

const SIDEBAR_STORAGE_KEY = "readwise:sidebar-collapsed";

/** Read the stored collapsed preference; null when unset/invalid. */
function getStoredCollapsed(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
    return null;
  } catch {
    return null;
  }
}

/**
 * Persistent collapsible left sidebar (US-149). Owns primary + secondary nav on
 * md+ (resolves the #134 header overflow by moving nav out of the header).
 * Hidden below md, where the BottomTabBar + More sheet provide nav.
 *
 * Collapsed state persists in localStorage. With no stored preference the
 * default is responsive: collapsed icon-rail on md (768–1023px), expanded on
 * lg+ (>=1024px). A stored preference always wins once the user toggles.
 */
export default function AppSidebar({ user }: { user: ShellUser | null }) {
  const pathname = usePathname();
  const isAdmin = user?.role === "Admin";

  // Default to expanded for SSR/first paint; the real value is resolved in the
  // effect below to avoid a hydration mismatch and respect stored/responsive
  // defaults.
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = getStoredCollapsed();
    if (stored !== null) {
      setCollapsed(stored);
    } else {
      // No stored preference — derive from viewport: lg+ expanded, md collapsed.
      const isLgUp =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(min-width: 1024px)").matches;
      setCollapsed(!isLgUp);
    }
    setMounted(true);
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      } catch {
        // Ignore storage failures (private mode, quota).
      }
      return next;
    });
  }

  const primary = PRIMARY_NAV.filter((item) => item.group === "primary");
  const secondary = PRIMARY_NAV.filter((item) => item.group === "secondary");

  const navLink = (href: string, label: string, Icon: LucideIcon) => {
    const active = isActivePath(pathname, href);
    return (
      <Link
        key={href}
        href={href}
        title={collapsed ? label : undefined}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group/link relative flex items-center rounded-[var(--radius-md)]",
          "h-11 text-[length:var(--text-sm)]",
          collapsed
            ? "justify-center px-0"
            : "gap-[var(--space-3)] px-[var(--space-3)]",
          "transition-colors [transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-standard)]",
          active
            ? "bg-bg-subtle font-semibold text-primary-text"
            : "font-medium text-text-muted hover:bg-bg-subtle hover:text-text",
          focusRing,
        )}
      >
        {/* Teal accent pill for the active item. */}
        {active ? (
          <span
            aria-hidden
            className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-[var(--radius-full)] bg-[var(--teal)]"
          />
        ) : null}
        <Icon size={20} aria-hidden className="shrink-0" />
        <span className={cn(collapsed ? "sr-only" : "truncate")}>{label}</span>
      </Link>
    );
  };

  return (
    <aside
      aria-label="Sidebar"
      data-collapsed={mounted ? collapsed : undefined}
      style={{
        width: collapsed
          ? "var(--sidebar-w-collapsed)"
          : "var(--sidebar-w)",
      }}
      className={cn(
        "hidden md:flex shrink-0 flex-col",
        "sticky top-14 h-[calc(100vh-3.5rem)] self-start",
        "border-r border-border bg-surface",
        "transition-[width] [transition-duration:var(--duration-base)] [transition-timing-function:var(--ease-standard)]",
      )}
    >
      <nav
        aria-label="Primary"
        className="flex flex-1 flex-col gap-[var(--space-1)] overflow-y-auto p-[var(--space-2)]"
      >
        {primary.map((item) => navLink(item.href, item.label, item.icon))}

        <hr className="my-[var(--space-2)] border-t border-border" />

        {secondary.map((item) => navLink(item.href, item.label, item.icon))}
      </nav>

      {/* Utility area: admin link + collapse toggle. */}
      <div className="flex flex-col gap-[var(--space-1)] border-t border-border p-[var(--space-2)]">
        {isAdmin ? navLink("/admin", "Admin", Shield) : null}

        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "flex h-11 items-center rounded-[var(--radius-md)]",
            "text-[length:var(--text-sm)] font-medium text-text-muted",
            collapsed
              ? "justify-center px-0"
              : "gap-[var(--space-3)] px-[var(--space-3)]",
            "transition-colors [transition-duration:var(--duration-fast)] [transition-timing-function:var(--ease-standard)]",
            "hover:bg-bg-subtle hover:text-text",
            focusRing,
          )}
        >
          {collapsed ? (
            <PanelLeft size={20} aria-hidden className="shrink-0" />
          ) : (
            <ChevronsLeft size={20} aria-hidden className="shrink-0" />
          )}
          <span className={cn(collapsed ? "sr-only" : "truncate")}>
            Collapse
          </span>
        </button>
      </div>
    </aside>
  );
}
