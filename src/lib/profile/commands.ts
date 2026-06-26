/**
 * Profile domain write commands (REF-685 / ADR-0010 §5).
 *
 * Encapsulates Prisma mutations and multi-step business logic for user
 * profiles so route handlers remain thin protocol adapters.
 */
import { prisma } from "@/lib/prisma";
import { getProfile } from "@/lib/profile/repository";
import type { ProfileInput } from "@/lib/profile/schema";

/**
 * Upserts a user's profile with a potential level-history record.
 *
 * When the English level changes, a `levelHistory` entry is created inside
 * the same transaction so the two writes are atomic.
 */
export async function updateProfile(userId: string, input: ProfileInput): Promise<void> {
  const existing = await getProfile(userId);
  const levelChanged = existing?.englishLevel !== input.englishLevel;

  const data = {
    ageRange: input.ageRange,
    gender: input.gender,
    englishLevel: input.englishLevel,
    topics: input.topics,
    ...(input.dailyGoal !== undefined ? { dailyGoal: input.dailyGoal } : {}),
    ...(levelChanged ? { levelUpdatedAt: new Date() } : {}),
  };

  await prisma.$transaction(async (tx) => {
    await tx.profile.upsert({
      where: { userId },
      create: { userId, ...data, completedAt: new Date() },
      update: data,
    });
    if (levelChanged) {
      await tx.levelHistory.create({
        data: { userId, level: input.englishLevel },
      });
    }
  });
}

/**
 * Upserts an onboarding profile record, stamping `completedAt` on creation
 * (and on update, to handle re-submissions from the onboarding flow).
 */
export async function completeOnboarding(userId: string, input: ProfileInput): Promise<void> {
  const data = {
    ageRange: input.ageRange,
    gender: input.gender,
    englishLevel: input.englishLevel,
    topics: input.topics,
    completedAt: new Date(),
    ...(input.dailyGoal !== undefined ? { dailyGoal: input.dailyGoal } : {}),
  };
  await prisma.profile.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}
