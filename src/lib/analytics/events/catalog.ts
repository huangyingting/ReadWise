/**
 * Analytics event type catalog and schema version (REF-049).
 *
 * Contains all product-critical event type constants and the schema version
 * stamp written into every event's `properties._v`. Kept separate from the
 * writer so read-side modules (query engines, dashboards) can import just the
 * catalog without pulling in Prisma/logger dependencies.
 */

/**
 * The versioned set of product-critical event types (RW-051). The string value
 * is the persisted `type`. Bump {@link ANALYTICS_SCHEMA_VERSION} whenever the
 * MEANING of an event or the shape of its `properties` changes.
 */
export const ANALYTICS_EVENT_TYPES = {
  onboardingStart: "onboarding_start",
  onboardingComplete: "onboarding_complete",
  articleView: "article_view",
  progressComplete: "progress_complete",
  lookup: "lookup",
  saveWord: "save_word",
  quizStart: "quiz_start",
  quizComplete: "quiz_complete",
  translationUse: "translation_use",
  tutorUse: "tutor_use",
  offlineSave: "offline_save",
  import: "import",
  studyReview: "study_review",
  // Today Session funnel (#802). Metadata-only lifecycle moments for the daily
  // reading task: generation, view, no-candidate, each step completion, the
  // whole-session completion (with tier), and a controlled-reason skip. Payloads
  // carry ids/enums/counts ONLY — never article/word content.
  todaySessionGenerated: "today_session_generated",
  todaySessionViewed: "today_session_viewed",
  todayNoCandidate: "today_no_candidate",
  todayReadingComplete: "today_reading_complete",
  todayComprehensionComplete: "today_comprehension_complete",
  todayWordReviewComplete: "today_word_review_complete",
  todaySessionComplete: "today_session_complete",
  todaySkip: "today_skip",
} as const;

/** Union of all canonical event type string literals. */
export type AnalyticsEventType =
  (typeof ANALYTICS_EVENT_TYPES)[keyof typeof ANALYTICS_EVENT_TYPES];

/** Every event type value, useful for documentation/tests/validation. */
export const ALL_ANALYTICS_EVENT_TYPES: readonly AnalyticsEventType[] =
  Object.values(ANALYTICS_EVENT_TYPES);

/**
 * Schema version for the analytics event stream. Stamped into every event's
 * `properties._v` so downstream consumers can interpret older rows correctly.
 * Bump on any breaking change to event semantics or property shapes.
 */
export const ANALYTICS_SCHEMA_VERSION = 1;
