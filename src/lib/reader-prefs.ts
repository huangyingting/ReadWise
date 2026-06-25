/**
 * Reader preferences module (M5) — the single source of truth for reading
 * mode (light | sepia | dark) and font scale (5 steps).
 *
 * Mirrors the pattern of `src/lib/theme.ts`:
 *  - SSR-safe (guards `window`/`document`)
 *  - React-free
 *  - Compatible with the blocking no-flash inline script in the reader page
 *    which reads `localStorage["readwise:reader-prefs"]` and sets
 *    `data-reading-mode` + `--reading-font-scale` pre-paint.
 *
 * Reading mode is READER-SCOPED and INDEPENDENT of the global app theme.
 * It only affects the `data-reading-mode` attribute on the reader root
 * element (never touches `<html>`'s `data-theme`).
 *
 * First-visit default: resolved global app theme (dark-app → dark reader,
 * light-app → light reader; never sepia by default).
 */

import { getActiveTheme } from "./theme";
import { STORAGE_KEYS } from "./storage-keys";

export type ReadingMode = "light" | "sepia" | "dark";
export type ReadingFont = "serif" | "sans" | "dyslexic";
export type ReadingSpacing = "normal" | "comfortable" | "spacious";

export interface ReaderPrefs {
  mode: ReadingMode;
  fontScale: number;
  fontFamily: ReadingFont;
  lineSpacing: ReadingSpacing;
}

/** Ordered font-scale steps (5 steps per Saul's spec). */
export const FONT_SCALE_STEPS = [0.9, 1.0, 1.15, 1.3, 1.45] as const;
export const DEFAULT_FONT_SCALE = 1.0;
export const READER_PREFS_KEY = STORAGE_KEYS.READER_PREFS;

const READING_MODES: readonly ReadingMode[] = ["light", "sepia", "dark"];
const READING_FONTS: readonly ReadingFont[] = ["serif", "sans", "dyslexic"];
const READING_SPACINGS: readonly ReadingSpacing[] = ["normal", "comfortable", "spacious"];

function isReadingMode(value: unknown): value is ReadingMode {
  return (
    typeof value === "string" &&
    (READING_MODES as readonly string[]).includes(value)
  );
}

function isReadingFont(value: unknown): value is ReadingFont {
  return (
    typeof value === "string" &&
    (READING_FONTS as readonly string[]).includes(value)
  );
}

function isReadingSpacing(value: unknown): value is ReadingSpacing {
  return (
    typeof value === "string" &&
    (READING_SPACINGS as readonly string[]).includes(value)
  );
}

function isFontScale(value: unknown): value is number {
  return (
    typeof value === "number" &&
    (FONT_SCALE_STEPS as readonly number[]).includes(value)
  );
}

/** Read stored prefs from localStorage; returns null if absent/invalid. */
export function getStoredReaderPrefs(): ReaderPrefs | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(READER_PREFS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "mode" in parsed &&
      "fontScale" in parsed &&
      isReadingMode((parsed as { mode: unknown }).mode) &&
      isFontScale((parsed as { fontScale: unknown }).fontScale)
    ) {
      return {
        mode: (parsed as ReaderPrefs).mode,
        fontScale: (parsed as ReaderPrefs).fontScale,
        fontFamily: isReadingFont((parsed as { fontFamily?: unknown }).fontFamily)
          ? (parsed as ReaderPrefs).fontFamily
          : "serif",
        lineSpacing: isReadingSpacing((parsed as { lineSpacing?: unknown }).lineSpacing)
          ? (parsed as ReaderPrefs).lineSpacing
          : "normal",
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * The effective reader prefs — stored value or sensible defaults.
 * Default mode = resolved global app theme (never sepia by default).
 */
export function getReaderPrefs(): ReaderPrefs {
  const stored = getStoredReaderPrefs();
  if (stored) return stored;
  const resolvedTheme = getActiveTheme(); // "light" | "dark"
  return { mode: resolvedTheme, fontScale: DEFAULT_FONT_SCALE, fontFamily: "serif", lineSpacing: "normal" };
}

/**
 * Apply reading prefs to the given root element (or the reader root by id).
 * Sets `data-reading-mode`, `data-reading-font`, `data-reading-spacing`
 * attributes and `--reading-font-scale` CSS variable.
 */
export function applyReaderPrefs(
  prefs: ReaderPrefs,
  rootEl?: HTMLElement | null,
): void {
  if (typeof document === "undefined") return;
  const el =
    rootEl ?? (document.getElementById("reader-root") as HTMLElement | null);
  if (!el) return;
  el.dataset.readingMode = prefs.mode;
  el.dataset.readingFont = prefs.fontFamily;
  el.dataset.readingSpacing = prefs.lineSpacing;
  el.style.setProperty("--reading-font-scale", String(prefs.fontScale));
}

/** Persist prefs to localStorage and apply immediately. */
export function setReaderPrefs(
  prefs: ReaderPrefs,
  rootEl?: HTMLElement | null,
): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(READER_PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Ignore storage failures — still apply at runtime.
    }
  }
  applyReaderPrefs(prefs, rootEl);
}

/** Step font scale up/down; returns the new scale (clamped to valid steps). */
export function stepFontScale(
  current: number,
  direction: "up" | "down",
): number {
  const idx = (FONT_SCALE_STEPS as readonly number[]).indexOf(current);
  const currentIdx = idx >= 0 ? idx : 1; // default to step 2 (1.0)
  if (direction === "up") {
    return FONT_SCALE_STEPS[Math.min(currentIdx + 1, FONT_SCALE_STEPS.length - 1)];
  }
  return FONT_SCALE_STEPS[Math.max(currentIdx - 1, 0)];
}

/** Label for a font scale step (for aria-live announcements). */
export function fontScaleLabel(scale: number): string {
  const map: Record<number, string> = {
    0.9: "Small",
    1.0: "Default",
    1.15: "Large",
    1.3: "Extra large",
    1.45: "Huge",
  };
  return map[scale] ?? "Default";
}

/**
 * Returns the minified no-flash bootstrap script text for inline injection.
 *
 * The script reads the reader prefs from localStorage and applies them to
 * `document.currentScript.parentElement` before the first paint, preventing a
 * flash of default (un-preferenced) reader appearance.
 *
 * Using the `READER_PREFS_KEY` constant keeps the key byte-for-byte consistent
 * with the rest of the module. Callers inject the return value via
 * `dangerouslySetInnerHTML` inside a `<script>` tag.
 *
 * Intended for use in `ReaderPrefsScript.tsx` and for unit testing.
 */
export function buildBootstrapScript(): string {
  return `(function(){try{var raw=localStorage.getItem('${READER_PREFS_KEY}');var prefs=raw?JSON.parse(raw):null;var el=document.currentScript&&document.currentScript.parentElement;if(!el)return;var mode=prefs&&prefs.mode?prefs.mode:(document.documentElement.dataset.theme==='dark'?'dark':'light');el.dataset.readingMode=mode;var scale=prefs&&typeof prefs.fontScale==='number'?prefs.fontScale:1;el.style.setProperty('--reading-font-scale',String(scale));var font=prefs&&prefs.fontFamily?prefs.fontFamily:'serif';el.dataset.readingFont=font;var spacing=prefs&&prefs.lineSpacing?prefs.lineSpacing:'normal';el.dataset.readingSpacing=spacing;}catch(e){}})();`;
}
