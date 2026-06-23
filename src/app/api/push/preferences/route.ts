import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import type { Schema } from "@/lib/validation";
import {
  getReminderPreference,
  upsertReminderPreference,
  validateReminderPreference,
} from "@/lib/reminder-preferences";

/**
 * Reminder preferences API (RW-045).
 *
 * GET  /api/push/preferences — current preference (defaults when never set).
 * PUT  /api/push/preferences — validate + upsert a partial preference update.
 *
 * Validation lives in `validateReminderPreference` (shared with tests), so the
 * body passes through a permissive object schema first (null values must reach
 * the validator intact to clear a field).
 */
const rawObjectBody: Schema<Record<string, unknown>> = (value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "body must be an object" };
  }
  return { ok: true, value: value as Record<string, unknown> };
};

export const GET = createHandler({}, async ({ session }) => {
  const preference = await getReminderPreference(session.user.id);
  return NextResponse.json({ preference });
});

export const PUT = createHandler(
  { body: rawObjectBody },
  async ({ body, session }) => {
    const parsed = validateReminderPreference(body);
    if (!parsed.ok) {
      throw new ApiError(400, parsed.error);
    }
    const preference = await upsertReminderPreference(session.user.id, parsed.value);
    return NextResponse.json({ preference });
  },
);
