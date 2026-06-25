import {
  Settings,
  Shield,
  SunMoon,
  Layers,
  Target,
  type LucideIcon,
} from "lucide-react";
import { PRIMARY_NAV } from "@/components/shell/nav-items";
import { toggleTheme } from "@/lib/theme";
import type { ListingArticle } from "@/lib/articles";

// ---- Item types -------------------------------------------------------

export type PageItem = {
  kind: "page";
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  keywords: string;
};

export type ActionItem = {
  kind: "action";
  id: string;
  label: string;
  icon: LucideIcon;
  keywords: string;
  href?: string;
  run?: () => void;
  /** Show this action in the empty-query (zero-state) default set. */
  showOnEmpty?: boolean;
};

// ---- Page items -------------------------------------------------------

const PAGE_KEYWORDS: Record<string, string> = {
  "/dashboard": "home streak goal",
  "/browse": "discover explore categories articles",
  "/study": "flashcards saved words vocabulary review",
};

const SETTINGS_PAGE: PageItem = {
  kind: "page",
  id: "page-settings",
  label: "Settings",
  href: "/settings",
  icon: Settings,
  keywords: "profile preferences level account",
};

const ADMIN_PAGE: PageItem = {
  kind: "page",
  id: "page-admin",
  label: "Admin",
  href: "/admin",
  icon: Shield,
  keywords: "manage members tags analytics",
};

/** Build the Pages list, optionally including the Admin entry. */
export function getPageItems(role?: string | null): PageItem[] {
  const nav = PRIMARY_NAV.map(
    (item): PageItem => ({
      kind: "page",
      id: `page-${item.href.slice(1)}`,
      label: item.label,
      href: item.href,
      icon: item.icon,
      keywords: PAGE_KEYWORDS[item.href] ?? "",
    }),
  );
  const pages: PageItem[] = [...nav, SETTINGS_PAGE];
  if (role === "Admin") pages.push(ADMIN_PAGE);
  return pages;
}

// ---- Action items -----------------------------------------------------

export const ACTION_ITEMS: ActionItem[] = [
  {
    kind: "action",
    id: "action-theme",
    label: "Toggle theme",
    icon: SunMoon,
    keywords: "dark light mode switch color appearance",
    run: toggleTheme,
    showOnEmpty: true,
  },
  {
    kind: "action",
    id: "action-study",
    label: "Start a flashcard review",
    icon: Layers,
    keywords: "flashcards study words learn review",
    href: "/study",
    showOnEmpty: true,
  },
  {
    kind: "action",
    id: "action-goal",
    label: "Go to today's goal",
    icon: Target,
    keywords: "daily goal progress streak dashboard",
    href: "/dashboard",
  },
  {
    kind: "action",
    id: "action-settings",
    label: "Open settings",
    icon: Settings,
    keywords: "profile preferences account level edit",
    href: "/settings",
  },
];

// ---- Selectable item shapes -------------------------------------------
// Selectable items are the item types with an `ariaId` added for ARIA
// active-descendant tracking. They live here so hooks and tests can import
// them independently of the full palette UI.

export type PageSelectable = PageItem & { ariaId: string };
export type ActionSelectable = ActionItem & { ariaId: string };
export type ArticleSelectable = {
  kind: "article";
  ariaId: string;
  article: ListingArticle;
};
export type MoreSelectable = { kind: "more"; ariaId: string; offset: number };
export type SelectableItem =
  | PageSelectable
  | ActionSelectable
  | ArticleSelectable
  | MoreSelectable;

// ---- Fuzzy matcher ----------------------------------------------------

/**
 * Subsequence fuzzy score. Case-insensitive.
 * Returns 0 for no match; higher = better (contiguous/prefix bonus).
 */
function fuzzyScore(text: string, query: string): number {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  let ti = 0;
  let prevIdx = -1;
  let score = 0;

  for (let qi = 0; qi < q.length; qi++) {
    const idx = t.indexOf(q[qi], ti);
    if (idx === -1) return 0;
    const gap = idx - prevIdx - 1;
    score += gap === 0 ? 4 : idx === 0 ? 3 : 1;
    prevIdx = idx;
    ti = idx + 1;
  }
  return score;
}

export function fuzzyFilter<T extends { label: string; keywords: string }>(
  items: T[],
  query: string,
): T[] {
  if (!query.trim()) return items;
  const q = query.trim();
  return items
    .map((item) => ({ item, score: fuzzyScore(`${item.label} ${item.keywords}`, q) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);
}
