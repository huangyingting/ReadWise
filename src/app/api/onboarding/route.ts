import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createHandler } from "@/lib/api-handler";
import type { Schema } from "@/lib/validation";
import { parseProfileInput, type ProfileInput } from "@/lib/profile";

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
  return NextResponse.json({ ok: true });
});
