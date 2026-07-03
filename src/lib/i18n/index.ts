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

/**
 * Keys whose catalog entry takes no parameters (`() => string`).
 * Derived automatically from the catalog interface so adding a new parameterless
 * entry here doesn't require updating this type manually.
 */
type ParamlessKey = {
  [K in MessageKey]: MessageCatalog[K] extends () => string ? K : never;
}[MessageKey];

/** Keys whose catalog entry is parameterized (`(params: {...}) => string`). */
type ParamKey = Exclude<MessageKey, ParamlessKey>;

type MessageParams<K extends ParamKey> = MessageCatalog[K] extends (
  params: infer P,
) => string
  ? P
  : never;

type MessageEntry = (params?: unknown) => string;

function catalogEntry(key: MessageKey): MessageEntry | undefined {
  const entry = en[key] as MessageEntry | undefined;
  return typeof entry === "function" ? entry : undefined;
}

function hasParamsArgument(paramsOrLocale: unknown): boolean {
  return paramsOrLocale !== undefined && typeof paramsOrLocale !== "string";
}

/**
 * Look up a UI message by key and return the formatted string.
 *
 * Phase 1 always uses the English catalog. The `locale` parameter is accepted
 * but unused; it exists so future phases can pass the resolved locale without
 * changing call sites.
 *
 * Two call signatures:
 *   // Parameterless message:
 *   const label = t("push.reminder.title");
 *
 *   // Parameterized message:
 *   const msg = t("reader.translate.unavailable", { lang: "Spanish" });
 */
export function t(key: ParamlessKey, _locale?: string): string;
export function t<K extends ParamKey>(
  key: K,
  params: MessageParams<K>,
  _locale?: string,
): string;
export function t(key: MessageKey, paramsOrLocale?: unknown, _locale?: string): string {
  const entry = catalogEntry(key);
  if (!entry) return key;

  try {
    if (!hasParamsArgument(paramsOrLocale)) {
      // Parameterless call — invoke with no arguments.
      return (entry as () => string)();
    }
    // Parameterized call — pass the params record.
    return (entry as (p: unknown) => string)(paramsOrLocale);
  } catch {
    return key;
  }
}
