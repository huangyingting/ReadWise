import {
  LayoutDashboard,
  Compass,
  Bookmark,
  BookOpen,
  StickyNote,
  TrendingUp,
  WifiOff,
  Download,
  Hash,
  GraduationCap,
  Presentation,
  Library,
  Shield,
  type LucideIcon,
} from "lucide-react";

/**
 * Shell-visible role gate. Shell visibility is convenience only — real
 * authorization is always enforced server-side.
 */
export type NavRole = "Admin";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * Placement group:
   * - `"primary"`  — main sidebar group + mobile bottom-bar tab
   * - `"secondary"` — secondary sidebar group + More sheet overflow
   * - `"utility"`  — sidebar utility area (collapse toggle row); not in mobile tabs
   */
  group: "primary" | "secondary" | "utility";
  /** Whether this item appears in the mobile bottom tab bar (≤ md). */
  mobileTab: boolean;
  /** Whether visiting this route requires an active session. */
  protected: boolean;
  /**
   * When set, only render this item for users with the specified role.
   * Shell visibility is convenience — server-side authorization is the real gate.
   */
  requiresRole?: NavRole;
}

/**
 * Route prefix used to detect the immersive reader. Components that need
 * reader-route behavior (hide bottom bar, collapse sidebar, hide theme toggle)
 * should import this constant rather than hardcoding the string.
 */
export const READER_ROUTE_PREFIX = "/reader/";

/**
 * Master navigation registry — single source of truth for every shell-visible
 * destination. Derived slices (`PRIMARY_NAV`, `PRIMARY_TABS`, `SECONDARY_NAV`,
 * `ADMIN_NAV_ITEMS`) are computed below.
 *
 * REF-054: one model, referenced by sidebar, bottom tabs, More sheet, and
 * protected-route derivation helpers.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard",   label: "Dashboard",     icon: LayoutDashboard, group: "primary",   mobileTab: true,  protected: true },
  { href: "/browse",      label: "Browse",        icon: Compass,         group: "primary",   mobileTab: true,  protected: true },
  { href: "/study",       label: "Study",         icon: BookOpen,        group: "primary",   mobileTab: true,  protected: true },
  { href: "/progress",    label: "Progress",      icon: TrendingUp,      group: "primary",   mobileTab: true,  protected: true },
  { href: "/series",      label: "Series",        icon: Library,         group: "secondary", mobileTab: false, protected: true },
  { href: "/import",      label: "Import",        icon: Download,        group: "secondary", mobileTab: false, protected: true },
  { href: "/lists",       label: "Saved articles", icon: Bookmark,       group: "secondary", mobileTab: false, protected: true },
  { href: "/notes",       label: "Notes",         icon: StickyNote,      group: "secondary", mobileTab: false, protected: true },
  { href: "/offline",     label: "Offline",       icon: WifiOff,         group: "secondary", mobileTab: false, protected: true },
  { href: "/tags",        label: "Tags",          icon: Hash,            group: "secondary", mobileTab: false, protected: true },
  { href: "/assignments", label: "Assignments",   icon: GraduationCap,   group: "secondary", mobileTab: false, protected: true },
  { href: "/teacher",     label: "Teaching",      icon: Presentation,    group: "secondary", mobileTab: false, protected: true },
  // Role-gated: only rendered for Admin users. Utility group — sidebar footer area.
  { href: "/admin",       label: "Admin",         icon: Shield,          group: "utility",   mobileTab: false, protected: true, requiresRole: "Admin" },
];

/** Primary navigation items (sidebar + main More-sheet entries). */
export const PRIMARY_NAV: NavItem[] = NAV_ITEMS.filter(
  (item) => item.group === "primary" || item.group === "secondary",
);

/**
 * Mobile bottom-bar destinations — items with `mobileTab: true` (the four
 * primary items: Dashboard, Browse, Study, Progress), in `NAV_ITEMS` order.
 */
export const PRIMARY_TABS: NavItem[] = NAV_ITEMS.filter((item) => item.mobileTab);

/**
 * Secondary navigation — Import, Saved articles, Notes, Offline, Tags, etc.,
 * derived from `NAV_ITEMS` by group so they can never drift out of sync.
 */
export const SECONDARY_NAV: NavItem[] = NAV_ITEMS.filter((item) => item.group === "secondary");

/**
 * Role-gated utility items (Admin). Renders in the sidebar utility area and
 * the mobile More sheet for users with the required role.
 */
export const ADMIN_NAV_ITEMS: NavItem[] = NAV_ITEMS.filter((item) => item.requiresRole === "Admin");

/**
 * Returns the href of every protected nav destination. Useful for tests that
 * verify middleware `PROTECTED_PREFIXES` coverage against the nav model.
 */
export function getNavProtectedPrefixes(): string[] {
  return NAV_ITEMS.filter((item) => item.protected).map((item) => item.href);
}

/**
 * Active-link test: exact match or prefix match for nested paths.
 * (e.g. `/reader/x` does not activate Browse, but a nested route under `/study`
 * would activate Study.)
 */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

// ---------------------------------------------------------------------------
// Pure helpers for sidebar state derivation (consumed by useSidebarState)
// ---------------------------------------------------------------------------

/**
 * Parse a raw localStorage string for the sidebar-collapsed preference.
 * Returns `null` when unset or the value is not a recognised boolean string.
 */
export function parseSidebarStored(raw: string | null): boolean | null {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

/**
 * Responsive sidebar default: collapsed on md (768–1023 px), expanded on
 * lg+ (≥ 1024 px). Accepts a `matchMedia` predicate so the function is
 * unit-testable without a real browser environment.
 */
export function getResponsiveDefault(
  matchMedia: (query: string) => boolean = (q) =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(q).matches,
): boolean {
  return !matchMedia("(min-width: 1024px)");
}

/**
 * Effective collapsed state: on a reader route the sidebar defaults to
 * collapsed (focused reading). A transient per-view override (set when the
 * user toggles on a reader page) takes precedence without mutating the global
 * stored preference.
 */
export function getEffectiveCollapsed(
  storedCollapsed: boolean,
  readerOverride: boolean | null,
  isReaderRoute: boolean,
): boolean {
  return isReaderRoute ? (readerOverride ?? true) : storedCollapsed;
}
