"use client";

import { dateKey } from "@/lib/engagement/time";
import { DEFAULT_TIMEZONE, isValidTimezoneString } from "@/lib/timezone";

export interface BrowserLocalDate {
  localDate: string;
  timezone: string;
}

/** Capture the browser's local calendar day before an offline-capable write. */
export function currentBrowserLocalDate(): BrowserLocalDate {
  let timezone = DEFAULT_TIMEZONE;
  try {
    const candidate = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (isValidTimezoneString(candidate)) timezone = candidate;
  } catch {
    // UTC remains the deterministic fallback.
  }
  return {
    localDate: dateKey(new Date(), timezone),
    timezone,
  };
}
