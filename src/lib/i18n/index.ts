/**
 * UI internationalization seam.
 *
 * Phase 1: t() always resolves against the English catalog. The function
 * signature is forward-compatible — future phases swap in a locale-specific
 * catalog without changing call sites.
 *
 * Usage:
 *
 *   import { t } from "@/lib/i18n";
 *
 *   // Parameterized message:
 *   const msg = t("reader.translate.unavailable", { lang: "Spanish" });
 *
 * Fallback contract:
 *   - Missing key in active locale → fall back to English catalog entry.
 *   - Missing key in English catalog → return the key string so the omission
 *     is immediately visible in the UI without throwing a runtime error.
 *
 * Client-safe: no Node-only imports. Safe for Server and Client Components.
 */

export type { MessageCatalog } from "./catalog";
export { en } from "./en";

import type { MessageCatalog } from "./catalog";
import { en } from "./en";

type MessageKey = keyof MessageCatalog;

type MessageParams<K extends MessageKey> = MessageCatalog[K] extends (
  params: infer P,
) => string
  ? P
  : never;

/**
 * Look up a UI message by key and return the formatted string.
 *
 * Phase 1 always uses the English catalog. The `locale` parameter is accepted
 * but unused; it exists so future phases can pass the resolved locale without
 * changing call sites.
 */
export function t<K extends MessageKey>(
  key: K,
  params: MessageParams<K>,
  _locale?: string,
): string {
  const entry = en[key];
  if (typeof entry === "function") {
    try {
      return (entry as (p: MessageParams<K>) => string)(params);
    } catch {
      return key;
    }
  }
  return key;
}
