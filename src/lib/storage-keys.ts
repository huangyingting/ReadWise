/**
 * Central browser-storage key registry and client persistence helpers (REF-077).
 *
 * Single source of truth for every localStorage, sessionStorage, and
 * service-worker postMessage key used by the ReadWise client.
 *
 * Scopes
 * ------
 * "local"   — localStorage: survives tab close and browser restart.
 * "session" — sessionStorage: scoped to the current browser tab / session.
 * "sw-msg"  — service-worker postMessage type (not a Web Storage key).
 *
 * Privacy levels
 * --------------
 * "user" — may contain personal/preference data; purge on sign-out /
 *          account deletion.
 * "app"  — application-level state with no personal data; may be retained.
 *
 * NOTE: layout.tsx and ReaderPrefsScript.tsx inline their key strings inside
 * `<script>` tags that run before React hydrates. Those literals MUST stay
 * byte-for-byte identical to the corresponding STORAGE_KEYS entries below.
 *
 * This module is client-safe: it imports nothing from server-only code.
 */

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const STORAGE_KEYS = {
  // ── localStorage: durable across browser sessions ─────────────────────────

  /** scope: local | privacy: user | owner: theme subsystem
   *  Payload: "light" | "dark" | "system"
   *  Matches the literal in layout.tsx's no-flash bootstrap `<script>`. */
  THEME: "readwise:theme",

  /** scope: local | privacy: user | owner: reader-prefs subsystem
   *  Payload: ReaderPrefs JSON { mode, fontScale, fontFamily, lineSpacing }
   *  Matches the literal in ReaderPrefsScript.tsx's no-flash bootstrap `<script>`. */
  READER_PREFS: "readwise:reader-prefs",

  /** scope: local | privacy: user | owner: translate / bilingual subsystem
   *  Payload: BCP-47 language code string */
  TRANSLATE_LANG: "readwise:translate-lang",

  /** scope: local | privacy: user | owner: AppSidebar
   *  Payload: "true" | "false" */
  SIDEBAR_COLLAPSED: "readwise:sidebar-collapsed",

  /** scope: local | privacy: user | owner: ReaderToolsProvider
   *  Payload: ToolTabId string */
  READER_TOOLS_TAB: "readwise:reader-tools-tab",

  /** scope: local | privacy: user | owner: WordLookupHint
   *  Payload: "1" (present = dismissed) */
  HINT_DISMISSED: "readwise:hint-dismissed",

  /** scope: local | privacy: user | owner: BilingualBody
   *  Payload: { enabled: boolean; lang: string } */
  BILINGUAL_PREFS: "readwise:bilingual",

  /** scope: local | privacy: user | owner: onboarding
   *  Payload: "1" (present = welcome tour completed) */
  WELCOME_SEEN: "readwise:welcome-seen",

  /** scope: local | privacy: user | owner: WordLookup / selection toolbar
   *  Payload: "yellow" | "green" | "blue" | "pink" */
  LAST_HL_COLOR: "readwise:last-hl-color",

  // ── sessionStorage: tab / session scoped ──────────────────────────────────

  /** scope: session | privacy: user | owner: reader navigation
   *  Payload: { href: string; label: string } */
  READER_REFERRER: "readwise:reader-referrer",

  /** scope: session | privacy: app | owner: listing progress refresh
   *  Payload: string[] — article IDs opened this session */
  VISITED_ARTICLES: "readwise:visited-articles",

  /** scope: session | privacy: app | owner: listing bookmark refresh
   *  Payload: string[] — article IDs whose bookmark state changed */
  BOOKMARK_CHANGES: "readwise:bookmark-changes",

  /** scope: session | privacy: app | owner: LevelRecommendationBanner
   *  Payload: "1" (present = dismissed for this session) */
  LEVEL_REC_DISMISSED: "readwise:level-rec-dismissed",

  // ── Service-worker postMessage types (not Web Storage keys) ───────────────

  /** Triggers the page to flush the offline mutation queue. Also sent by the
   *  SW on Background Sync. Must stay in sync with FLUSH_MESSAGE in sw.js. */
  SW_FLUSH_QUEUE: "readwise:flush-queue",

  /** Instructs the active SW to drop all readwise-* runtime caches (privacy
   *  purge on sign-out / account deletion). Must stay in sync with sw.js. */
  SW_PURGE_CACHES: "readwise:purge-caches",
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

// ---------------------------------------------------------------------------
// Safe localStorage helpers
// ---------------------------------------------------------------------------

/**
 * Read a string value from localStorage.
 * Returns null on SSR or when storage is unavailable (private mode, quota).
 */
export function lsGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Write a string value to localStorage.
 * Silently ignores SSR and storage errors (private mode, quota).
 */
export function lsSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures — private mode, quota exceeded.
  }
}

/**
 * Remove a key from localStorage.
 * Silently ignores SSR and storage errors.
 */
export function lsRemove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Safe sessionStorage helpers
// ---------------------------------------------------------------------------

/**
 * Read a string value from sessionStorage.
 * Returns null on SSR or when storage is unavailable.
 */
export function ssGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Write a string value to sessionStorage.
 * Silently ignores SSR and storage errors (private mode, quota).
 */
export function ssSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Ignore storage failures — private mode, quota exceeded.
  }
}

/**
 * Remove a key from sessionStorage.
 * Silently ignores SSR and storage errors.
 */
export function ssRemove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}
