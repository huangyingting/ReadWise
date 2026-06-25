"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { STORAGE_KEYS, lsGet, lsSet } from "@/lib/storage-keys";
import {
  READER_ROUTE_PREFIX,
  parseSidebarStored,
  getResponsiveDefault,
  getEffectiveCollapsed,
} from "./nav-items";

/** Value returned by `useSidebarState`. */
export interface SidebarState {
  /** Effective collapsed flag — accounts for reader-route override. */
  collapsed: boolean;
  /**
   * `true` once the hook has mounted and resolved the localStorage preference.
   * Use this to avoid rendering a hydration mismatch (e.g. `data-collapsed`
   * on the `<aside>` should only be set after mount).
   */
  mounted: boolean;
  /**
   * Toggle collapsed. On regular routes this persists to localStorage.
   * On reader routes it applies a transient per-view override that is
   * discarded when the user leaves the reader, preserving the global pref.
   */
  toggle: () => void;
}

/**
 * Manages sidebar collapsed state for the app shell (REF-054).
 *
 * - Reads / writes `STORAGE_KEYS.SIDEBAR_COLLAPSED` (localStorage) as the
 *   global preference.
 * - Responsive default when no preference is stored: collapsed on md
 *   (768–1023 px), expanded on lg+ (≥ 1024 px).
 * - On `/reader/*` routes the sidebar defaults to collapsed (focused-reading
 *   mode) WITHOUT overwriting the stored global preference. The user may
 *   temporarily expand it; that override resets when they leave the reader.
 * - Publishes `--app-sidebar-w` on `<html>` so fixed overlays (e.g.
 *   `ReaderMiniPlayer`) can inset correctly at any breakpoint.
 */
export function useSidebarState(): SidebarState {
  const pathname = usePathname();
  const isReaderRoute = (pathname ?? "").startsWith(READER_ROUTE_PREFIX);

  // Global stored preference. SSR/first-paint default: false (expanded) to
  // avoid a hydration mismatch; resolved client-side in the first effect.
  const [storedCollapsed, setStoredCollapsed] = useState(false);
  // Transient per-view override for reader routes (does not touch localStorage).
  const [readerOverride, setReaderOverride] = useState<boolean | null>(null);
  const [mounted, setMounted] = useState(false);

  // Resolve the stored preference (or responsive default) on the client.
  useEffect(() => {
    const raw = lsGet(STORAGE_KEYS.SIDEBAR_COLLAPSED);
    const stored = parseSidebarStored(raw);
    setStoredCollapsed(stored ?? getResponsiveDefault());
    setMounted(true);
  }, []);

  // Reset the transient reader override on each reader-route entry/exit so
  // every reader visit starts collapsed and non-reader routes follow the pref.
  useEffect(() => {
    setReaderOverride(null);
  }, [isReaderRoute]);

  const collapsed = getEffectiveCollapsed(storedCollapsed, readerOverride, isReaderRoute);

  // Publish sidebar width as a CSS custom property so fixed overlays can inset.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(
      "--app-sidebar-w",
      collapsed ? "var(--sidebar-w-collapsed)" : "var(--sidebar-w)",
    );
    return () => {
      root.style.removeProperty("--app-sidebar-w");
    };
  }, [collapsed]);

  function toggle() {
    if (isReaderRoute) {
      // Focused reading mode — transient override only, never persist.
      setReaderOverride(!collapsed);
      return;
    }
    setStoredCollapsed((prev) => {
      const next = !prev;
      lsSet(STORAGE_KEYS.SIDEBAR_COLLAPSED, String(next));
      return next;
    });
  }

  return { collapsed, mounted, toggle };
}
