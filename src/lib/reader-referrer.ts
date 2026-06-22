/**
 * Shared sessionStorage contract for the reader "Back" button.
 *
 * A listing (or any surface that links into `/reader/[id]`) records where the
 * user came from under {@link READER_REFERRER_KEY}; the reader's back button
 * reads it to return there instead of always falling back to the dashboard.
 *
 * Both `ReferrerLink` (declarative) and imperative callers (e.g. the command
 * palette, which navigates via `router.push`) must use this same key/shape.
 */
export const READER_REFERRER_KEY = "readwise:reader-referrer";

export interface ReaderReferrer {
  href: string;
  label: string;
}

/** Persist the reader referrer. Safe to call in any browser context. */
export function setReaderReferrer(referrer: ReaderReferrer): void {
  try {
    sessionStorage.setItem(READER_REFERRER_KEY, JSON.stringify(referrer));
  } catch {
    // Ignore storage errors (private mode, quota, SSR misuse).
  }
}
