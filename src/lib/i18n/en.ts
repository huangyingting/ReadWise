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
import { SITE_NAME } from "@/lib/copy/site";

export const en: MessageCatalog = {
  // ---------------------------------------------------------------------------
  // Reader
  // ---------------------------------------------------------------------------

  "reader.translate.unavailable": ({ lang }) =>
    `Translation into ${lang} is unavailable right now because the AI ` +
    `translation service is not configured. Please try again later.`,

  // ---------------------------------------------------------------------------
  // AI provider fallback messages
  // ---------------------------------------------------------------------------

  "ai.tutor.unavailable": () =>
    "AI feature unavailable — the AI tutor is not available right now. Please try again later.",

  "ai.quiz.unavailable": () =>
    "AI feature unavailable — quiz generation is not available right now. Please try again later.",

  "ai.translation.unavailable": () =>
    "AI feature unavailable — translation is not available right now.",

  "ai.vocabulary.unavailable.title": () => "Vocabulary unavailable",

  "ai.vocabulary.unavailable.description": () =>
    "AI vocabulary extraction is not available right now. Please try again later.",

  // ---------------------------------------------------------------------------
  // Push notifications
  // ---------------------------------------------------------------------------

  "push.reminder.title": () => "Time to review! 📚",

  "push.reminder.body": ({ count }) =>
    count === 1
      ? `You have 1 word due for review in ${SITE_NAME}.`
      : `You have ${count} words due for review in ${SITE_NAME}.`,
};
