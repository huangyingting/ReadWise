/**
 * Shared IANA timezone validation helpers.
 *
 * The validator itself stays in the offline registry because offline payload
 * guards need a client-safe implementation. Route schemas import from here so
 * progress and Today endpoints reject invalid browser timezones consistently.
 */

import { isValidTimezoneString } from "@/lib/offline/registry";
import { optional, string, type Schema, type ValidationResult } from "@/lib/validation";

export { isValidTimezoneString };

export const MAX_TIMEZONE_CHARS = 100;
export const DEFAULT_TIMEZONE = "UTC";

export function resolveTimezone(
  requestTimezone?: string | null,
  profileTimezone?: string | null,
): string {
  if (isValidTimezoneString(requestTimezone)) return requestTimezone;
  if (isValidTimezoneString(profileTimezone)) return profileTimezone;
  return DEFAULT_TIMEZONE;
}

export const timezoneString: Schema<string> = (value, field) => {
  const parsed = string({ max: MAX_TIMEZONE_CHARS })(value, field);
  if (!parsed.ok) return parsed;
  if (!isValidTimezoneString(parsed.value)) {
    return { ok: false, error: `${field ?? "timezone"} must be a valid IANA timezone` };
  }
  return parsed;
};

export const optionalTimezoneString = optional(timezoneString);

export function parseOptionalTimezoneQuery(
  params: URLSearchParams,
  name = "timezone",
): ValidationResult<{ timezone: string | null }> {
  const raw = params.get(name);
  if (raw === null) return { ok: true, value: { timezone: null } };
  const parsed = timezoneString(raw, name);
  if (!parsed.ok) return parsed;
  return { ok: true, value: { timezone: parsed.value } };
}
