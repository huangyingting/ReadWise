/**
 * Theme module (M2) — the single source of truth for theme get/apply/set/toggle.
 *
 * Stays compatible with the blocking no-flash script in `src/app/layout.tsx`,
 * which reads `localStorage["readwise:theme"]`: a stored "light"/"dark" forces
 * `data-theme` pre-paint, while anything else (incl. "system" or absent) falls
 * back to `prefers-color-scheme`.
 *
 * 3-state model:
 *   - "light" / "dark": explicit override, written to `data-theme`.
 *   - "system": no explicit override — the stored value is "system" and the
 *     runtime REMOVES the `data-theme` attribute so the CSS media fallback wins.
 *
 * All functions are SSR-safe (guard `window`/`document`) and React-free.
 */

import { STORAGE_KEYS } from "./storage-keys";

export type Theme = "light" | "dark" | "system";

/** Concrete theme actually applied to the page (never "system"). */
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = STORAGE_KEYS.THEME;

const THEME_VALUES: readonly Theme[] = ["light", "dark", "system"];

function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEME_VALUES as readonly string[]).includes(value);
}

/** Read the stored theme preference; returns null when unset/invalid. */
export function getStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** The user's 3-state preference, defaulting to "system" when unset. */
export function getThemePreference(): Theme {
  return getStoredTheme() ?? "system";
}

/** OS-level preference via `prefers-color-scheme`. */
export function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Resolve a preference to a concrete light/dark value. */
export function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === "system" ? getSystemTheme() : theme;
}

/**
 * The concrete theme currently in effect — reads the live `data-theme`
 * attribute first (what the no-flash script wrote), then falls back to the
 * stored preference, then the system preference. Mirrors the script's order.
 */
export function getActiveTheme(): ResolvedTheme {
  if (typeof document !== "undefined") {
    const attr = document.documentElement.dataset.theme;
    if (attr === "light" || attr === "dark") return attr;
  }
  return resolveTheme(getThemePreference());
}

/**
 * Apply a preference to the document. Explicit light/dark sets the same
 * `data-theme` attribute the no-flash script writes; "system" REMOVES the
 * attribute so the `@media (prefers-color-scheme)` fallback in tokens.css wins.
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = theme;
  }
}

/** Persist a preference to localStorage and apply it immediately. */
export function setTheme(theme: Theme): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage failures (private mode, quota) — still apply at runtime.
    }
  }
  applyTheme(theme);
}

/** Cycle Light → Dark → System → Light, persist, and return the new value. */
export function toggleTheme(): Theme {
  const order: Theme[] = ["light", "dark", "system"];
  const current = getThemePreference();
  const next = order[(order.indexOf(current) + 1) % order.length];
  setTheme(next);
  return next;
}
