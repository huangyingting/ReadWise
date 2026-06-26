import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createHandler } from "@/lib/api-handler";
import type { Schema } from "@/lib/validation";
import { parseProfileInput, type ProfileInput } from "@/features/profile-preferences/schema";
import { recordEvent, ANALYTICS_EVENT_TYPES } from "@/lib/analytics/events";
import { revalidateUserCache } from "@/lib/cache";

const profileSchema: Schema<ProfileInput> = (value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "Request body must be an object" };
  }
  return parseProfileInput(value as Record<string, unknown>);
};

export const POST = createHandler({ body: profileSchema }, async ({ body, session }) => {
  const data = {
    ageRange: body.ageRange,
    gender: body.gender,
    englishLevel: body.englishLevel,
    topics: body.topics,
    completedAt: new Date(),
    ...(body.dailyGoal !== undefined ? { dailyGoal: body.dailyGoal } : {}),
  };
  await prisma.profile.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, ...data },
    update: data,
  });
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
