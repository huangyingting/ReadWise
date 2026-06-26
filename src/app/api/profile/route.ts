import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import type { Schema } from "@/lib/validation";
import { parseProfileInput, type ProfileInput } from "@/features/profile-preferences/schema";
import { updateProfile } from "@/lib/profile/commands";
import { revalidateUserCache } from "@/lib/cache";

const profileSchema: Schema<ProfileInput> = (value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "Request body must be an object" };
  }
  return parseProfileInput(value as Record<string, unknown>);
};

export const PUT = createHandler({ body: profileSchema }, async ({ body, session }) => {
  // Run profile upsert + optional level history record in one transaction.
  await updateProfile(session.user.id, body);

  // Profile changes (topics, level) affect feed scoring — bust the user's feed cache.
  revalidateUserCache(session.user.id);

  return NextResponse.json({ ok: true });
});
