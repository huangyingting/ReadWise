/**
 * Core product identity and site-level metadata copy.
 *
 * Single place to review product name, taglines, and site metadata strings.
 * Strings are kept byte-identical to their original scattered locations so
 * this is a pure centralization refactor with no copy changes.
 *
 * Localization note: replace these strings (or replace this module's exports
 * with locale-keyed lookups) when a real i18n project starts.
 */

/** The product name used across metadata, notifications, and manifest. */
export const SITE_NAME = "ReadWise";

/**
 * Next.js title template for `<title>` generation.
 * Pages set their own `title` string; this template wraps it.
 */
export const TITLE_TEMPLATE = `%s | ${SITE_NAME}`;

/** Default `<title>` when no page-level title is set (root layout fallback). */
export const SITE_DEFAULT_TITLE = `${SITE_NAME} — AI-Assisted English Learning Reader`;

/** Primary meta description for the site (HTML `<meta name="description">`). */
export const SITE_DESCRIPTION =
  "Read cleaned news articles with on-demand AI translation, vocabulary, quizzes, narration, and CEFR leveling. Learn English from real news.";

/** OpenGraph / Twitter shared title (same wording as the default title). */
export const OG_TITLE = SITE_DEFAULT_TITLE;

/**
 * OpenGraph / Twitter shared description.
 * Slightly shorter than SITE_DESCRIPTION; both OG and Twitter use this copy.
 */
export const OG_DESCRIPTION =
  "Read cleaned news articles with on-demand AI translation, vocabulary, quizzes, and narration. Improve your English with real news.";

/**
 * PWA manifest description shown in app-install prompts.
 * Distinct from SITE_DESCRIPTION to fit manifest copy conventions.
 */
export const MANIFEST_DESCRIPTION =
  "AI-assisted English learning reader with real news articles, CEFR leveling, translation, vocabulary, and narration.";
