import { LayoutDashboard, Compass, Bookmark, BookOpen, StickyNote, TrendingUp, WifiOff, Download, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  group: "primary" | "secondary";
}

/** Primary navigation — shared by AppNav (desktop) and MobileDrawer. */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, group: "primary" },
  { href: "/browse", label: "Browse", icon: Compass, group: "primary" },
  { href: "/import", label: "Import", icon: Download, group: "secondary" },
  { href: "/lists", label: "Saved", icon: Bookmark, group: "secondary" },
  { href: "/study", label: "Study", icon: BookOpen, group: "primary" },
  { href: "/notes", label: "Notes", icon: StickyNote, group: "secondary" },
  { href: "/progress", label: "Progress", icon: TrendingUp, group: "primary" },
  { href: "/offline", label: "Offline", icon: WifiOff, group: "secondary" },
];

/**
 * Mobile bottom-bar destinations — the four primary items, derived from
 * `PRIMARY_NAV` by group so they can never drift out of sync. Order follows
 * `PRIMARY_NAV`: Dashboard, Browse, Study, Progress.
 */
export const PRIMARY_TABS: NavItem[] = PRIMARY_NAV.filter((item) => item.group === "primary");

/**
 * Secondary navigation — Saved, Notes, Import, Offline (in `PRIMARY_NAV` order),
 * derived from `PRIMARY_NAV` by group.
 */
export const SECONDARY_NAV: NavItem[] = PRIMARY_NAV.filter((item) => item.group === "secondary");

/**
 * Active-link test mirroring AdminNav: exact match for the link itself, plus a
 * prefix match for nested paths (e.g. `/reader/x` does not light Browse, but a
 * future nested route under a nav item would).
 */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
