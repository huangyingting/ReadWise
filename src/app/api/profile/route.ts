import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createHandler } from "@/lib/api-handler";
import type { Schema } from "@/lib/validation";
import { parseProfileInput, getProfile, type ProfileInput } from "@/lib/profile";

const profileSchema: Schema<ProfileInput> = (value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "Request body must be an object" };
  }
  return parseProfileInput(value as Record<string, unknown>);
};

export const PUT = createHandler({ body: profileSchema }, async ({ body, session }) => {
  const existing = await getProfile(session.user.id);
  const levelChanged = existing?.englishLevel !== body.englishLevel;

  const data = {
    ageRange: body.ageRange,
    gender: body.gender,
    englishLevel: body.englishLevel,
    topics: body.topics,
    ...(body.dailyGoal !== undefined ? { dailyGoal: body.dailyGoal } : {}),
    // Record when the level is explicitly changed by the user.
    ...(levelChanged ? { levelUpdatedAt: new Date() } : {}),
  };

  // Run profile upsert + optional level history record in one transaction.
  await prisma.$transaction(async (tx) => {
    await tx.profile.upsert({
      where: { userId: session.user.id },
      create: { userId: session.user.id, ...data, completedAt: new Date() },
      update: data,
    });

    if (levelChanged) {
      await tx.levelHistory.create({
        data: { userId: session.user.id, level: body.englishLevel },
      });
    }
  });

  return NextResponse.json({ ok: true });
});
