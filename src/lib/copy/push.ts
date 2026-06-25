/**
 * Push notification and reminder UI copy.
 *
 * Centralizes all user-visible strings for the Web Push / SRS reminder
 * feature — both the server-sent notification payload and the client-side
 * settings UI. Keeping these together makes copy review easy and is the first
 * step toward localization readiness.
 *
 * Strings are byte-identical to the originals they replaced.
 *
 * Server-side payload constants (reminder) can be safely imported from server
 * code. The `ui` namespace is also safe to import from both server and client
 * modules because it contains only plain string constants.
 */
import { SITE_NAME } from "./site";

// ---------------------------------------------------------------------------
// Push notification payload (server-side — src/lib/push.ts)
// ---------------------------------------------------------------------------

export const reminder = {
  /** Notification title shown in the OS notification center. */
  title: "Time to review! 📚",

  /**
   * Notification body text.
   * Returns singular or plural copy depending on the count of due words.
   */
  body: (count: number): string =>
    count === 1
      ? `You have 1 word due for review in ${SITE_NAME}.`
      : `You have ${count} words due for review in ${SITE_NAME}.`,

  /** Deep-link URL opened when the user taps the notification. */
  url: "/study",

  /** Icon shown in the notification (PWA icon path). */
  icon: "/icons/icon-192.png",
} as const satisfies {
  title: string;
  body: (count: number) => string;
  url: string;
  icon: string;
};

// ---------------------------------------------------------------------------
// Settings / toggle UI copy (PushReminderToggle + ReminderPreferencesForm)
// ---------------------------------------------------------------------------

export const ui = {
  /** Section heading for the "Review reminders" toggle row. */
  toggleLabel: "Review reminders",

  /** Description shown when the user has not yet subscribed. */
  subscribePrompt: "Get notified when words in your study list are ready to review again.",

  /** Description shown when the user is subscribed. */
  subscribedInfo:
    "Push notifications are enabled. You'll get a reminder when words are ready to review — at most one reminder per day.",

  /** Description shown when the browser has blocked notifications. */
  deniedInfo: "Notifications are blocked. Enable them in your browser settings.",

  /** aria-label for the subscribe switch. */
  enableAriaLabel: "Enable review reminders",

  /** aria-label for the unsubscribe switch. */
  disableAriaLabel: "Disable review reminders",

  /** Status text shown while toggling on. */
  enablingText: "Enabling…",

  /** Status text shown while toggling off. */
  disablingText: "Disabling…",

  /** Error message shown when the subscribe flow fails. */
  subscribeError: "Failed to enable push notifications.",

  /** Error message shown when the unsubscribe flow fails. */
  unsubscribeError: "Failed to disable push notifications.",

  /** Shown in unsupported browsers. */
  unsupportedText: "Push notifications are not supported in your browser.",
} as const;
