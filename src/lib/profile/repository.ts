import type { Profile } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export function getProfile(userId: string): Promise<Profile | null> {
  return prisma.profile.findUnique({ where: { userId } });
}

export function isOnboarded(profile: Profile | null): boolean {
  return Boolean(profile?.completedAt);
}

export async function isUserOnboarded(userId: string): Promise<boolean> {
  return isOnboarded(await getProfile(userId));
}
