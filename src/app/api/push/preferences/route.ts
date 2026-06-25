import { NextResponse } from "next/server";
import { createHandler, ApiError } from "@/lib/api-handler";
import {
  getReminderPreference,
  upsertReminderPreference,
  validateReminderPreference,
} from "@/lib/reminder-preferences";
import { rawObjectBody } from "@/lib/push/schemas";

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
