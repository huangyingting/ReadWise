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

  // ---------------------------------------------------------------------------
  // AI provider fallback messages
  // ---------------------------------------------------------------------------

  /**
   * Returned by the AI tutor when the AI service is not configured or fails.
   * Shown as the assistant answer with `fallback: true`.
   */
  "ai.tutor.unavailable": () => string;

  /**
   * Shown in the quiz panel when AI quiz generation is unavailable.
   */
  "ai.quiz.unavailable": () => string;

  /**
   * Shown in the bilingual reader banner when AI translation is unavailable.
   */
  "ai.translation.unavailable": () => string;

  /**
   * Title shown in the vocabulary panel when AI extraction is unavailable.
   */
  "ai.vocabulary.unavailable.title": () => string;

  /**
   * Description shown in the vocabulary panel when AI extraction is unavailable.
   */
  "ai.vocabulary.unavailable.description": () => string;

  // ---------------------------------------------------------------------------
  // Push notifications
  // ---------------------------------------------------------------------------

  /**
   * Title of the OS push notification for due-word reminders.
   */
  "push.reminder.title": () => string;

  /**
   * Body of the OS push notification for due-word reminders.
   * `count` is the number of words due for review.
   */
  "push.reminder.body": (params: { count: number }) => string;

  /**
   * Title of the OS push notification when the Today Session feature is
   * enabled (nudges the learner to their `/today` session).
   */
  "push.reminder.todayTitle": () => string;

  /**
   * Body of the OS push notification when the Today Session feature is
   * enabled. `count` is the number of words due for review. Copy stays
   * generic — no article titles, word text, or other private content.
   */
  "push.reminder.todayBody": (params: { count: number }) => string;

  // ---------------------------------------------------------------------------
  // Reading fluency feedback (#813)
  // ---------------------------------------------------------------------------

  /**
   * Fluency-panel copy for an improving reading-speed trend. Encouraging,
   * non-punitive — never exposes raw WPM in the message text.
   */
  "fluency.trend.improving": () => string;

  /** Fluency-panel copy for a stable (consistent) reading-speed trend. */
  "fluency.trend.stable": () => string;

  /**
   * Fluency-panel copy for a declining trend. Intentionally framed positively
   * (slower reads often mean harder content) to avoid punitive messaging.
   */
  "fluency.trend.declining": () => string;

  /**
   * Fluency-panel copy when there is not yet enough data to show a trend.
   */
  "fluency.trend.insufficient_data": () => string;

  // ---------------------------------------------------------------------------
  // Curated reading series (#813)
  // ---------------------------------------------------------------------------

  /** Heading for the learner-facing series browser. */
  "series.browser.title": () => string;

  /** Empty-state copy when no public series are available. */
  "series.browser.empty": () => string;

  /** Enroll call-to-action label. */
  "series.action.enroll": () => string;

  /** Unenroll / leave-series call-to-action label. */
  "series.action.unenroll": () => string;

  /** Badge label shown on a series the learner has completed. */
  "series.status.completed": () => string;
}
