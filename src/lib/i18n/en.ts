/**
 * English (en) message catalog — the fallback locale and source of truth.
 *
 * Strings are kept in sync with their original locations. When a call site
 * migrates to t(), the hard-coded string is removed and this entry becomes
 * the single source of that copy.
 *
 * Client-safe: no Node-only imports.
 */

import type { MessageCatalog } from "./catalog";

export const en: MessageCatalog = {
  "reader.translate.unavailable": ({ lang }) =>
    `Translation into ${lang} is unavailable right now because the AI ` +
    `translation service is not configured. Please try again later.`,
};
