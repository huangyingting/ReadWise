import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import type { Schema } from "@/lib/validation";
import { parseProfileInput, type ProfileInput } from "@/features/profile-preferences/schema";
import { updateProfile } from "@/lib/profile/commands";
import { revalidateUserCache } from "@/lib/cache";

function isProfileInputRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const profileSchema: Schema<ProfileInput> = (value) => {
  if (!isProfileInputRecord(value)) {
    return { ok: false, error: "Request body must be an object" };
  }
  return parseProfileInput(value);
};

async function saveProfileInput(userId: string, body: ProfileInput) {
  // Run profile upsert + optional level history record in one transaction.
  await updateProfile(userId, body);

  // Profile changes (topics, level) affect feed scoring — bust the user's feed cache.
  revalidateUserCache(userId);
}

export const PUT = createHandler({ body: profileSchema }, async ({ body, session }) => {
  await saveProfileInput(session.user.id, body);
  return NextResponse.json({ ok: true });
});
