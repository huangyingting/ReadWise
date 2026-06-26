/**
 * UI message catalog type.
 *
 * Keys use dot-separated namespace segments: <domain>.<surface>.<variant>
 * Values are either plain strings or functions that accept a params record and
 * return a string. Parameterized messages use functions so that TypeScript
 * enforces the required params at call sites.
 *
 * Add new keys here (and to the English catalog in en.ts) when introducing
 * new localizable copy. The interface is the source of truth; all locale
 * catalogs must satisfy it.
 *
 * Client-safe: no Node-only imports. Safe for use in Server and Client Components.
 */

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

export interface MessageCatalog {
  /**
   * Shown in the reader when AI translation is unavailable.
   * `lang` is the human-readable target language label (e.g. "Spanish").
   */
  "reader.translate.unavailable": (params: { lang: string }) => string;
}
