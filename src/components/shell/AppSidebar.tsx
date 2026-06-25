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
import { STORAGE_KEYS } from "@/lib/storage-keys";

const SIDEBAR_STORAGE_KEY = STORAGE_KEYS.SIDEBAR_COLLAPSED;

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
 *
 * #169 — focused reading mode: while on a `/reader/*` route the sidebar renders
 * in its collapsed icon-rail state BY DEFAULT (frees reading width, removes the
 * competing full nav). This is a derived/effective state — the global
 * `readwise:sidebar-collapsed` preference is NEVER overwritten by visiting a
 * reader page. The user can still expand it for the current view via a transient
 * override that resets when they leave the reader route.
 */
export default function AppSidebar({ user }: { user: ShellUser | null }) {
  const pathname = usePathname();
  const isAdmin = user?.role === "Admin";
  const isReaderRoute = pathname?.startsWith("/reader") ?? false;

  // The persisted global preference (responsive default until resolved in the
  // effect below). Default to expanded for SSR/first paint to avoid a hydration
  // mismatch; the real stored value is resolved client-side.
  const [storedCollapsed, setStoredCollapsed] = useState(false);
  // Transient per-view override that lets the user expand/collapse on a reader
  // route WITHOUT mutating the global preference. Reset when the route changes.
  const [readerOverride, setReaderOverride] = useState<boolean | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = getStoredCollapsed();
    if (stored !== null) {
      setStoredCollapsed(stored);
    } else {
      // No stored preference — derive from viewport: lg+ expanded, md collapsed.
      const isLgUp =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(min-width: 1024px)").matches;
      setStoredCollapsed(!isLgUp);
    }
    setMounted(true);
  }, []);

  // Drop the transient reader override whenever we enter/leave a reader route so
  // each reader visit starts collapsed and other routes follow the stored pref.
  useEffect(() => {
    setReaderOverride(null);
  }, [isReaderRoute]);

  // Effective collapsed state: on a reader route default to collapsed
  // (storedCollapsed || isReaderRoute), but honor a transient user override.
  const effectiveCollapsed = isReaderRoute
    ? (readerOverride ?? true)
    : storedCollapsed;

  // Publish the live sidebar width so the fixed ReaderMiniPlayer can inset past
  // it (md+) and never paint over the sidebar column.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(
      "--app-sidebar-w",
      effectiveCollapsed ? "var(--sidebar-w-collapsed)" : "var(--sidebar-w)",
    );
    return () => {
      root.style.removeProperty("--app-sidebar-w");
    };
  }, [effectiveCollapsed]);

  function toggle() {
    if (isReaderRoute) {
      // Focused reading mode — transient override only, never persist so the
      // global preference is preserved.
      setReaderOverride(!effectiveCollapsed);
      return;
    }
    setStoredCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      } catch {
        // Ignore storage failures (private mode, quota).
      }
      return next;
    });
  }

  const collapsed = effectiveCollapsed;

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
