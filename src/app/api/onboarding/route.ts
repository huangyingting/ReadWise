import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import type { Schema } from "@/lib/validation";
import { parseProfileInput, type ProfileInput } from "@/features/profile-preferences/schema";
import { completeOnboarding } from "@/lib/profile/commands";
import { recordEvent, ANALYTICS_EVENT_TYPES } from "@/lib/analytics/events";
import { revalidateUserCache } from "@/lib/cache";

const profileSchema: Schema<ProfileInput> = (value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "Request body must be an object" };
  }
  return parseProfileInput(value as Record<string, unknown>);
};

export const POST = createHandler({ body: profileSchema }, async ({ body, session }) => {
  await completeOnboarding(session.user.id, body);

  // Product analytics (RW-051): onboarding completion is the funnel entry point.
  // Metadata only — never the user's free-text answers.
  await recordEvent({
    type: ANALYTICS_EVENT_TYPES.onboardingComplete,
    userId: session.user.id,
    properties: {
      englishLevel: body.englishLevel,
      topicCount: Array.isArray(body.topics) ? body.topics.length : 0,
    },
  });

  // Onboarding creates the user profile that drives feed personalisation — bust
  // the user's feed cache so the next request reflects the new profile.
  revalidateUserCache(session.user.id);

  return NextResponse.json({ ok: true });
});
