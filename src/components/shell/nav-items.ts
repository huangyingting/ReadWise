import { LayoutDashboard, Compass, Bookmark, BookOpen, StickyNote, TrendingUp, WifiOff, Download, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Primary navigation — shared by AppNav (desktop) and MobileDrawer. */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/browse", label: "Browse", icon: Compass },
  { href: "/import", label: "Import", icon: Download },
  { href: "/lists", label: "Saved", icon: Bookmark },
  { href: "/study", label: "Study", icon: BookOpen },
  { href: "/notes", label: "Notes", icon: StickyNote },
  { href: "/progress", label: "Progress", icon: TrendingUp },
  { href: "/offline", label: "Offline", icon: WifiOff },
];

/**
 * Active-link test mirroring AdminNav: exact match for the link itself, plus a
 * prefix match for nested paths (e.g. `/reader/x` does not light Browse, but a
 * future nested route under a nav item would).
 */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
