/**
 * Feature-owned schema module for push notification routes (REF-043).
 * Exports body schemas and their inferred TypeScript types so both route
 * handlers and tests can import the contracts directly.
 */

import {
  object,
  nonEmptyString,
  type Schema,
} from "@/lib/validation";

/** Helper: extract the validated value type from any Schema<T>. */
type InferSchema<S extends Schema<unknown>> = S extends Schema<infer T> ? T : never;

const SUBSCRIPTION_FIELD_LIMITS = {
  endpoint: 2048,
  p256dh: 256,
  auth: 128,
} as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// POST /api/push/subscribe
// ---------------------------------------------------------------------------

export const subscribeBody = object({
  endpoint: nonEmptyString(SUBSCRIPTION_FIELD_LIMITS.endpoint),
  p256dh: nonEmptyString(SUBSCRIPTION_FIELD_LIMITS.p256dh),
  auth: nonEmptyString(SUBSCRIPTION_FIELD_LIMITS.auth),
});

export type SubscribeBody = InferSchema<typeof subscribeBody>;

// ---------------------------------------------------------------------------
// POST /api/push/unsubscribe
// ---------------------------------------------------------------------------

export const unsubscribeBody = object({
  endpoint: nonEmptyString(2048),
});

export type UnsubscribeBody = InferSchema<typeof unsubscribeBody>;

// ---------------------------------------------------------------------------
// PUT /api/push/preferences
// A permissive pass-through schema: the actual validation lives in
// `validateReminderPreference` so null values reach the validator intact.
// ---------------------------------------------------------------------------

export const rawObjectBody: Schema<Record<string, unknown>> = (value) => {
  if (!isPlainRecord(value)) {
    return { ok: false, error: "body must be an object" };
  }
  return { ok: true, value };
};
