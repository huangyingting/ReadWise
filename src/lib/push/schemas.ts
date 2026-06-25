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

// ---------------------------------------------------------------------------
// POST /api/push/subscribe
// ---------------------------------------------------------------------------

export const subscribeBody = object({
  endpoint: nonEmptyString(2048),
  p256dh: nonEmptyString(256),
  auth: nonEmptyString(128),
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
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "body must be an object" };
  }
  return { ok: true, value: value as Record<string, unknown> };
};
