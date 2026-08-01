/** Content-free notification tags used to collapse reminder retries in the browser. */

export type ReminderNotificationKind = "srs" | "assignment" | "assignment-nudge";

const MAX_IDEMPOTENCY_KEY_LENGTH = 80;
const SAFE_IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]+$/;

function safeIdempotencyKey(value: string | undefined): string | null {
  if (
    value &&
    value.length <= MAX_IDEMPOTENCY_KEY_LENGTH &&
    SAFE_IDEMPOTENCY_KEY_RE.test(value)
  ) {
    return value;
  }
  return null;
}

/**
 * Durable jobs supply their stable job id. Direct hourly schedulers fall back
 * to the UTC hour, so a replay of the same scheduled batch replaces the prior
 * browser notification instead of displaying another one.
 */
export function reminderNotificationTag(
  kind: ReminderNotificationKind,
  now: Date,
  idempotencyKey?: string,
): string {
  const key = safeIdempotencyKey(idempotencyKey) ?? now.toISOString().slice(0, 13);
  return `readwise:${kind}:${key}`;
}
