"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeft, ChevronsLeft } from "lucide-react";
import { Button, Tooltip } from "@/components/ui";
import { cn, focusRing } from "@/lib/cn";
import {
  PRIMARY_NAV,
  ADMIN_NAV_ITEMS,
  isActivePath,
  filterNavForUser,
  type NavItem,
} from "./nav-items";
import type { ShellUser } from "./types";
import { useSidebarState } from "./useSidebarState";

const SIDEBAR_CONTROL_HEIGHT =
  "h-[5dvh] min-h-[var(--space-6)] max-h-11";
const SIDEBAR_STACK_GAP =
  "gap-[clamp(0px,0.5dvh,var(--space-1))]";
const SIDEBAR_STACK_PADDING =
  "p-[clamp(var(--space-1),1dvh,var(--space-2))]";

/**
 * Persistent collapsible left sidebar (US-149). Owns primary + secondary nav on
 * md+ (resolves the #134 header overflow by moving nav out of the header).
 * Hidden below md, where the BottomTabBar + More sheet provide nav.
 *
 * Collapsed state persists in localStorage via `useSidebarState`. With no
 * stored preference the default is responsive: collapsed icon-rail on md
 * (768–1023px), expanded on lg+ (>=1024px).
 *
 * #169 — focused reading mode: while on a `/reader/*` route the sidebar renders
 * in its collapsed icon-rail state by default (frees reading width). This is a
 * derived/effective state — the global `readwise:sidebar-collapsed` preference
 * is NEVER overwritten by visiting a reader page. The user can still expand it
 * for the current view via a transient override that resets when they leave.
 */
export default function AppSidebar({ user }: { user: ShellUser | null }) {
  const pathname = usePathname();
  const isAdmin = user?.role === "Admin";
  const { collapsed, mounted, toggle } = useSidebarState();

  const primaryNav = filterNavForUser(PRIMARY_NAV, user?.showTodayNav ?? false).filter(hasNavGroup("primary"));
  const secondaryNav = filterNavForUser(PRIMARY_NAV, user?.showTodayNav ?? false).filter(hasNavGroup("secondary"));
  const renderNavItem = (item: NavItem) => (
    <SidebarNavLink
      key={item.href}
      item={item}
      pathname={pathname}
      collapsed={collapsed}
    />
  );

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
        "sticky top-[var(--header-height)] h-[calc(100dvh-var(--header-height))] self-start",
        "border-r border-border bg-surface",
        "transition-[width] [transition-duration:var(--duration-base)] [transition-timing-function:var(--ease-standard)]",
      )}
    >
      <nav
        aria-label="Primary"
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-y-auto",
          SIDEBAR_STACK_GAP,
          SIDEBAR_STACK_PADDING,
          collapsed && "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        {primaryNav.map(renderNavItem)}

        <hr className="my-[clamp(var(--space-1),1dvh,var(--space-2))] shrink-0 border-t border-border" />

        {secondaryNav.map(renderNavItem)}
      </nav>

      {/* Utility area: admin link (role-gated) + collapse toggle. */}
      <div
        className={cn(
          "flex shrink-0 flex-col border-t border-border",
          SIDEBAR_STACK_GAP,
          SIDEBAR_STACK_PADDING,
        )}
      >
        {isAdmin
          ? ADMIN_NAV_ITEMS.map(renderNavItem)
          : null}

        <Tooltip
          content={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          side={collapsed ? "right" : "top"}
          wrap={false}
          className="w-full"
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={toggle}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            leadingIcon={
              collapsed ? (
                <PanelLeft size={20} aria-hidden className="shrink-0" />
              ) : (
                <ChevronsLeft size={20} aria-hidden className="shrink-0" />
              )
            }
            className={cn(
              SIDEBAR_CONTROL_HEIGHT,
              "w-full rounded-[var(--radius-md)] text-[length:var(--text-sm)] font-semibold text-text-muted hover:text-text",
              collapsed
                ? "justify-center gap-0 px-0"
                : "justify-start gap-[var(--space-3)] px-[var(--space-3)]",
            )}
          >
            <span className={cn(collapsed ? "sr-only" : "truncate")}>
              Collapse
            </span>
          </Button>
        </Tooltip>
      </div>
    </aside>
  );
}

function hasNavGroup(group: NavItem["group"]) {
  return (item: NavItem) => item.group === group;
}

function SidebarNavLink({
  item,
  pathname,
  collapsed,
}: {
  item: Pick<NavItem, "href" | "label" | "icon">;
  pathname: string;
  collapsed: boolean;
}) {
  const { href, label, icon: Icon } = item;
  const active = isActivePath(pathname, href);

  const link = (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group/link relative flex w-full items-center rounded-[var(--radius-md)]",
        SIDEBAR_CONTROL_HEIGHT,
        "text-[length:var(--text-sm)]",
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

  return collapsed ? (
    <Tooltip content={label} side="right" wrap={false} className="w-full">
      {link}
    </Tooltip>
  ) : (
    link
  );
}
